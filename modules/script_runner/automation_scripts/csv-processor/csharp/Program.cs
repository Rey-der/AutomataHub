/// <summary>
/// csv-processor — Reads CSV files, validates rows, and outputs structured reports.
/// C# variant for integration with .NET-based environments.
///
/// Processing pipeline:
///   1. Scans CSV_INPUT_DIR for .csv files
///   2. Parses each file using RFC 4180 rules (quoted fields, escaped quotes)
///   3. Detects column headers from the first row
///   4. Validates each data row:
///      - Every header column must have a non-empty value
///      - Columns whose header contains "amount", "price", "total", "qty",
///        or "quantity" are checked for numeric values
///   5. Stores a summary row per file in the csv_processing table
///   6. Outputs a JSON report
///
/// Environment variables:
///   CSV_INPUT_DIR — folder to scan (default: ~/Documents/csv-input)
///
/// Writes:
///   - csv_processing (one per processed file)
///   - automation_logs (start, per-file outcome, summary)
///   - execution_tracking (start → finish)
///   - errors (on failure)
/// </summary>
/// 
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

class Program
{
    /// <summary>Keywords that indicate a numeric column (case-insensitive partial match).</summary>
    static readonly string[] NumericKeywords = { "amount", "price", "total", "qty", "quantity" };

    /// <summary>
    /// Parses a single CSV line respecting RFC 4180 quoted fields.
    /// Handles commas inside quotes and escaped double-quotes ("").
    /// </summary>
    /// <param name="line">Raw CSV line.</param>
    /// <returns>Array of trimmed field values.</returns>
    static string[] ParseCsvLine(string line)
    {
        var fields = new List<string>();
        var current = new StringBuilder();
        bool inQuotes = false;
        int i = 0;

        while (i < line.Length)
        {
            char ch = line[i];

            if (inQuotes)
            {
                if (ch == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"')
                    {
                        current.Append('"');
                        i += 2;
                    }
                    else
                    {
                        inQuotes = false;
                        i++;
                    }
                }
                else
                {
                    current.Append(ch);
                    i++;
                }
            }
            else if (ch == '"')
            {
                inQuotes = true;
                i++;
            }
            else if (ch == ',')
            {
                fields.Add(current.ToString().Trim());
                current.Clear();
                i++;
            }
            else
            {
                current.Append(ch);
                i++;
            }
        }

        fields.Add(current.ToString().Trim());
        return fields.ToArray();
    }

    /// <summary>
    /// Checks whether a column header implies a numeric value.
    /// </summary>
    /// <param name="header">Column header text.</param>
    /// <returns>True if the header matches a numeric keyword.</returns>
    static bool IsNumericColumn(string header)
    {
        string lower = header.ToLowerInvariant();
        return NumericKeywords.Any(kw => lower.Contains(kw));
    }

    /// <summary>
    /// Validates a parsed row against the header columns.
    /// </summary>
    /// <param name="headers">Column headers from the first row.</param>
    /// <param name="fields">Parsed field values for this row.</param>
    /// <returns>Null if valid, or an error message string if invalid.</returns>
    static string? ValidateRow(string[] headers, string[] fields)
    {
        if (fields.Length != headers.Length)
            return $"expected {headers.Length} columns, got {fields.Length}";

        for (int c = 0; c < headers.Length; c++)
        {
            if (string.IsNullOrWhiteSpace(fields[c]))
                return $"empty value in column \"{headers[c]}\"";

            if (IsNumericColumn(headers[c]) && !double.TryParse(fields[c], NumberStyles.Any, CultureInfo.InvariantCulture, out _))
                return $"non-numeric value \"{fields[c]}\" in column \"{headers[c]}\"";
        }

        return null;
    }

    /// <summary>
    /// Entry point — processes CSV files from the input directory.
    /// </summary>
    /// <param name="args">Command-line arguments (unused).</param>
    /// <returns>0 on success, 1 on error.</returns>
    static int Main(string[] args)
    {
        string? dbPath = Environment.GetEnvironmentVariable("SMART_DESKTOP_DB");
        if (string.IsNullOrEmpty(dbPath))
        {
            Console.Error.WriteLine("ERROR: SMART_DESKTOP_DB environment variable is not set.");
            return 1;
        }

        string inputDir = Environment.GetEnvironmentVariable("CSV_INPUT_DIR")
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Documents", "csv-input");

        if (!Directory.Exists(inputDir))
        {
            Console.WriteLine($"CSV input directory not found: {inputDir}");
            Console.WriteLine("Set CSV_INPUT_DIR or create ~/Documents/csv-input with .csv files.");
            return 0;
        }

        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();

        string scriptName = "csv-processor";
        string startTime = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");

        long executionId;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "INSERT INTO execution_tracking (script, start_time) VALUES (@script, @start)";
            cmd.Parameters.AddWithValue("@script", scriptName);
            cmd.Parameters.AddWithValue("@start", startTime);
            cmd.ExecuteNonQuery();
            executionId = (long)new SqliteCommand("SELECT last_insert_rowid()", connection).ExecuteScalar()!;
        }

        InsertLog(connection, scriptName, "INFO", $"Scanning {inputDir}");

        try
        {
            var csvFiles = Directory.GetFiles(inputDir, "*.csv");

            if (csvFiles.Length == 0)
            {
                InsertLog(connection, scriptName, "INFO", "No CSV files found.");
                FinishExecution(connection, executionId, "SUCCESS");
                var emptyResult = new { processed = 0, files = Array.Empty<object>() };
                Console.WriteLine(JsonSerializer.Serialize(emptyResult, new JsonSerializerOptions { WriteIndented = true }));
                return 0;
            }

            var fileSummaries = new List<object>();
            int totalValid = 0;
            int totalInvalid = 0;

            foreach (string filePath in csvFiles)
            {
                string filename = Path.GetFileName(filePath);
                try
                {
                    string[] lines = File.ReadAllLines(filePath)
                        .Where(l => !string.IsNullOrWhiteSpace(l))
                        .ToArray();

                    if (lines.Length == 0)
                    {
                        InsertLog(connection, scriptName, "INFO", $"Skipped {filename}: empty file");
                        fileSummaries.Add(new { filename, rows_total = 0, rows_valid = 0, rows_invalid = 0 });
                        continue;
                    }

                    string[] headers = ParseCsvLine(lines[0]);
                    int valid = 0;
                    int invalid = 0;

                    for (int r = 1; r < lines.Length; r++)
                    {
                        string[] fields = ParseCsvLine(lines[r]);
                        string? error = ValidateRow(headers, fields);
                        if (error == null)
                            valid++;
                        else
                            invalid++;
                    }

                    int rowsTotal = lines.Length - 1;

                    using (var cmd = connection.CreateCommand())
                    {
                        cmd.CommandText = "INSERT INTO csv_processing (filename, rows_total, rows_valid, rows_invalid) VALUES (@fn, @total, @valid, @invalid)";
                        cmd.Parameters.AddWithValue("@fn", filename);
                        cmd.Parameters.AddWithValue("@total", rowsTotal);
                        cmd.Parameters.AddWithValue("@valid", valid);
                        cmd.Parameters.AddWithValue("@invalid", invalid);
                        cmd.ExecuteNonQuery();
                    }

                    InsertLog(connection, scriptName, "INFO", $"Processed {filename}: {valid} valid, {invalid} invalid of {rowsTotal} rows");

                    fileSummaries.Add(new { filename, rows_total = rowsTotal, rows_valid = valid, rows_invalid = invalid });
                    totalValid += valid;
                    totalInvalid += invalid;
                }
                catch (IOException ex)
                {
                    InsertLog(connection, scriptName, "ERROR", $"Failed to process {filename}: {ex.Message}");
                    fileSummaries.Add(new { filename, rows_total = 0, rows_valid = 0, rows_invalid = 0, error = ex.Message });
                }
            }

            InsertLog(connection, scriptName, "SUCCESS", $"Processed {csvFiles.Length} files: {totalValid} valid rows, {totalInvalid} invalid rows");
            FinishExecution(connection, executionId, "SUCCESS");

            Console.WriteLine("CSV processing complete.\n");
            var result = new { processed = csvFiles.Length, totalValid, totalInvalid, files = fileSummaries };
            Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex)
        {
            InsertError(connection, scriptName, ex);
            FinishExecution(connection, executionId, "FAIL", ex.Message);
            Console.Error.WriteLine($"FATAL: {ex.Message}");
            return 1;
        }

        return 0;
    }

    /// <summary>
    /// Inserts a row into the automation_logs table.
    /// </summary>
    /// <param name="conn">Open SQLite connection.</param>
    /// <param name="script">Script identifier.</param>
    /// <param name="status">Log level (INFO, ERROR, SUCCESS).</param>
    /// <param name="message">Human-readable log message.</param>
    static void InsertLog(SqliteConnection conn, string script, string status, string message)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO automation_logs (script, status, message) VALUES (@script, @status, @msg)";
        cmd.Parameters.AddWithValue("@script", script);
        cmd.Parameters.AddWithValue("@status", status);
        cmd.Parameters.AddWithValue("@msg", message);
        cmd.ExecuteNonQuery();
    }

    /// <summary>
    /// Inserts a row into the errors table.
    /// </summary>
    /// <param name="conn">Open SQLite connection.</param>
    /// <param name="script">Script identifier.</param>
    /// <param name="ex">Exception to record.</param>
    static void InsertError(SqliteConnection conn, string script, Exception ex)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO errors (script, message, stack_trace) VALUES (@script, @msg, @stack)";
        cmd.Parameters.AddWithValue("@script", script);
        cmd.Parameters.AddWithValue("@msg", ex.Message);
        cmd.Parameters.AddWithValue("@stack", ex.StackTrace ?? "");
        cmd.ExecuteNonQuery();
    }

    /// <summary>
    /// Updates execution_tracking with end time and final status.
    /// </summary>
    /// <param name="conn">Open SQLite connection.</param>
    /// <param name="id">Execution tracking row ID.</param>
    /// <param name="status">Final status (SUCCESS, FAIL).</param>
    /// <param name="errorMsg">Optional error message for FAIL status.</param>
    static void FinishExecution(SqliteConnection conn, long id, string status, string? errorMsg = null)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE execution_tracking SET end_time = @end, status = @status, error_message = @msg WHERE id = @id";
        cmd.Parameters.AddWithValue("@end", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
        cmd.Parameters.AddWithValue("@status", status);
        cmd.Parameters.AddWithValue("@msg", (object?)errorMsg ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@id", id);
        cmd.ExecuteNonQuery();
    }
}
