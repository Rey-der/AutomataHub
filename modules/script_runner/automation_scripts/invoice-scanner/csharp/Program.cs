/// <summary>
/// invoice-scanner — Scans a folder for PDF invoices and extracts basic data.
/// C# variant for integration with .NET-based environments.
///
/// Extraction strategy (text-based):
///   1. Reads PDF files from the configured folder
///   2. Extracts text content and searches for vendor, amount, date
///   3. Writes extracted data to the invoices table
///
/// Environment variables:
///   INVOICE_DIR — folder to scan (default: ~/Documents/Invoices)
///
/// Writes:
///   - invoices (one per successfully extracted file)
///   - automation_logs
///   - execution_tracking
///   - errors (on failure)
/// </summary>

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

class Program
{
    static int Main(string[] args)
    {
        string? dbPath = Environment.GetEnvironmentVariable("SMART_DESKTOP_DB");
        if (string.IsNullOrEmpty(dbPath))
        {
            Console.Error.WriteLine("ERROR: SMART_DESKTOP_DB environment variable is not set.");
            return 1;
        }

        string invoiceDir = Environment.GetEnvironmentVariable("INVOICE_DIR")
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Documents", "Invoices");

        if (!Directory.Exists(invoiceDir))
        {
            Console.WriteLine($"Invoice directory not found: {invoiceDir}");
            Console.WriteLine("Set INVOICE_DIR or create ~/Documents/Invoices with PDF files.");
            return 0;
        }

        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();

        string scriptName = "invoice-scanner";
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

        InsertLog(connection, scriptName, "INFO", $"Scanning {invoiceDir}");

        try
        {
            var files = Directory.GetFiles(invoiceDir, "*.pdf", SearchOption.TopDirectoryOnly);

            if (files.Length == 0)
            {
                InsertLog(connection, scriptName, "INFO", "No PDF files found.");
                FinishExecution(connection, executionId, "SUCCESS");
                var emptyResult = new { scanned = 0, extracted = 0, failed = 0 };
                Console.WriteLine(JsonSerializer.Serialize(emptyResult, new JsonSerializerOptions { WriteIndented = true }));
                return 0;
            }

            int extracted = 0;
            int failed = 0;

            foreach (var filePath in files)
            {
                string fileName = Path.GetFileName(filePath);
                try
                {
                    byte[] buffer = File.ReadAllBytes(filePath);
                    string text = ExtractTextFromPdf(buffer);

                    string vendor = VendorFromFilename(fileName);
                    double? amount = ExtractAmount(text);
                    string? invoiceDate = ExtractDate(text);

                    if (amount == null)
                    {
                        InsertLog(connection, scriptName, "INFO", $"Skipped {fileName}: no amount found");
                        failed++;
                        continue;
                    }

                    using var cmd = connection.CreateCommand();
                    cmd.CommandText = @"INSERT INTO invoices (vendor, amount, invoice_date, file_path)
                                        VALUES (@vendor, @amount, @date, @path)";
                    cmd.Parameters.AddWithValue("@vendor", vendor);
                    cmd.Parameters.AddWithValue("@amount", amount.Value);
                    cmd.Parameters.AddWithValue("@date", invoiceDate ?? DateTime.UtcNow.ToString("yyyy-MM-dd"));
                    cmd.Parameters.AddWithValue("@path", filePath);
                    cmd.ExecuteNonQuery();

                    InsertLog(connection, scriptName, "INFO", $"Extracted: {fileName} → {vendor}, {amount}");
                    extracted++;
                }
                catch (Exception ex)
                {
                    InsertLog(connection, scriptName, "ERROR", $"Failed to process {fileName}: {ex.Message}");
                    failed++;
                }
            }

            InsertLog(connection, scriptName, "SUCCESS", $"Scanned {files.Length} PDFs: {extracted} extracted, {failed} failed");
            FinishExecution(connection, executionId, "SUCCESS");

            Console.WriteLine("Invoice scan complete.\n");
            var result = new { scanned = files.Length, extracted, failed };
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

    static string ExtractTextFromPdf(byte[] buffer)
    {
        // Lightweight text extraction from PDF text streams (BT...ET blocks)
        string content = Encoding.Latin1.GetString(buffer);
        var chunks = new List<string>();

        var btEtRegex = new Regex(@"BT\s([\s\S]*?)ET");
        foreach (Match btMatch in btEtRegex.Matches(content))
        {
            var parenRegex = new Regex(@"\(([^)]*)\)");
            foreach (Match pMatch in parenRegex.Matches(btMatch.Groups[1].Value))
            {
                chunks.Add(pMatch.Groups[1].Value);
            }
        }
        return string.Join(" ", chunks).Trim();
    }

    static double? ExtractAmount(string text)
    {
        var patterns = new[]
        {
            new Regex(@"[$€£]\s?([\d,]+\.?\d*)"),
            new Regex(@"([\d,]+\.\d{2})\b"),
        };

        foreach (var pattern in patterns)
        {
            var m = pattern.Match(text);
            if (m.Success)
            {
                string cleaned = m.Groups[1].Value.Replace(",", "");
                if (double.TryParse(cleaned, System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out double num) && num > 0)
                    return num;
            }
        }
        return null;
    }

    static string? ExtractDate(string text)
    {
        // YYYY-MM-DD
        var iso = Regex.Match(text, @"(\d{4}-\d{2}-\d{2})");
        if (iso.Success) return iso.Groups[1].Value;

        // DD.MM.YYYY or DD/MM/YYYY
        var dmy = Regex.Match(text, @"(\d{2})[./](\d{2})[./](\d{4})");
        if (dmy.Success) return $"{dmy.Groups[3].Value}-{dmy.Groups[2].Value}-{dmy.Groups[1].Value}";

        return null;
    }

    static string VendorFromFilename(string filename)
    {
        string baseName = Path.GetFileNameWithoutExtension(filename);
        var parts = Regex.Split(baseName, @"[_\-\s\d]+").Where(p => p.Length > 0).ToArray();
        if (parts.Length > 0)
            return char.ToUpper(parts[0][0]) + parts[0][1..].ToLower();
        return baseName;
    }

    static void InsertLog(SqliteConnection conn, string script, string status, string message)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO automation_logs (script, status, message) VALUES (@script, @status, @msg)";
        cmd.Parameters.AddWithValue("@script", script);
        cmd.Parameters.AddWithValue("@status", status);
        cmd.Parameters.AddWithValue("@msg", message);
        cmd.ExecuteNonQuery();
    }

    static void InsertError(SqliteConnection conn, string script, Exception ex)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO errors (script, message, stack_trace) VALUES (@script, @msg, @stack)";
        cmd.Parameters.AddWithValue("@script", script);
        cmd.Parameters.AddWithValue("@msg", ex.Message);
        cmd.Parameters.AddWithValue("@stack", ex.StackTrace ?? "");
        cmd.ExecuteNonQuery();
    }

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
