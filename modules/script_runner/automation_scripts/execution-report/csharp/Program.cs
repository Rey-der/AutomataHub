/// <summary>
/// execution-report — Displays recent script executions with duration and status.
/// C# variant for integration with .NET-based environments.
/// Outputs JSON to stdout for script_runner display.
/// Default: last 20 executions. Pass a number as first arg to override.
/// </summary>

using System;
using System.Collections.Generic;
using System.Text.Json;
using Microsoft.Data.Sqlite;

class Program
{
    /// <summary>
    /// Entry point — queries execution_tracking with computed duration and outputs JSON.
    /// </summary>
    /// <param name="args">Optional: first arg is the row limit (default 20).</param>
    /// <returns>0 on success, 1 on error.</returns>
    static int Main(string[] args)
    {
        string? dbPath = Environment.GetEnvironmentVariable("SMART_DESKTOP_DB");
        if (string.IsNullOrEmpty(dbPath))
        {
            Console.Error.WriteLine("ERROR: SMART_DESKTOP_DB environment variable is not set.");
            return 1;
        }

        int limit = 20;
        if (args.Length > 0 && int.TryParse(args[0], out int parsed))
            limit = parsed;

        try
        {
            using var connection = new SqliteConnection($"Data Source={dbPath};Mode=ReadOnly");
            connection.Open();

            using var cmd = connection.CreateCommand();
            cmd.CommandText = @"
                SELECT
                    id,
                    script,
                    start_time,
                    end_time,
                    status,
                    error_message,
                    CASE
                        WHEN end_time IS NOT NULL
                        THEN ROUND((julianday(end_time) - julianday(start_time)) * 86400, 1)
                        ELSE NULL
                    END AS duration_seconds
                FROM execution_tracking
                ORDER BY start_time DESC
                LIMIT @limit";
            cmd.Parameters.AddWithValue("@limit", limit);

            using var reader = cmd.ExecuteReader();

            var rows = new List<Dictionary<string, object?>>();
            while (reader.Read())
            {
                var row = new Dictionary<string, object?>();
                for (int i = 0; i < reader.FieldCount; i++)
                    row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                rows.Add(row);
            }

            if (rows.Count == 0)
            {
                Console.WriteLine("No execution records found.");
            }
            else
            {
                Console.WriteLine($"Last {rows.Count} script executions:\n");
                Console.WriteLine(JsonSerializer.Serialize(rows, new JsonSerializerOptions { WriteIndented = true }));
            }

            return 0;
        }
        catch (SqliteException ex)
        {
            Console.Error.WriteLine($"Database error: {ex.Message}");
            return 1;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Unexpected error [{ex.GetType().Name}]: {ex.Message}");
            return 1;
        }
    }
}
