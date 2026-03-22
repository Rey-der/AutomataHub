/// <summary>
/// backup-query — Displays backup history, most recent first.
/// C# variant for integration with .NET-based environments.
/// Outputs JSON to stdout for script_runner display.
/// </summary>

using System;
using System.Collections.Generic;
using System.Text.Json;
using Microsoft.Data.Sqlite;

class Program
{
    /// <summary>
    /// Entry point — queries backup_history table and outputs JSON to stdout.
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

        try
        {
            using var connection = new SqliteConnection($"Data Source={dbPath};Mode=ReadOnly");
            connection.Open();

            using var cmd = connection.CreateCommand();
            cmd.CommandText = "SELECT * FROM backup_history ORDER BY backup_date DESC";

            using var reader = cmd.ExecuteReader();

            var rows = new List<Dictionary<string, object?>>();
            while (reader.Read())
            {
                var row = new Dictionary<string, object?>();
                for (int i = 0; i < reader.FieldCount; i++)
                {
                    row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                }
                rows.Add(row);
            }

            if (rows.Count == 0)
            {
                Console.WriteLine("No backup history found.");
            }
            else
            {
                Console.WriteLine($"Backup history ({rows.Count} entries):\n");
                var options = new JsonSerializerOptions { WriteIndented = true };
                Console.WriteLine(JsonSerializer.Serialize(rows, options));
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
