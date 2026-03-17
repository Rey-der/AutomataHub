/// <summary>
/// error-report — Displays recent errors with script name, timestamp, and message.
/// C# variant for integration with .NET-based environments.
/// Outputs JSON to stdout for script_runner display.
/// Default: last 20 errors. Pass a number as first arg to override.
/// </summary>

using System;
using System.Collections.Generic;
using System.Text.Json;
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

        int limit = 20;
        if (args.Length > 0 && int.TryParse(args[0], out int parsed))
            limit = parsed;

        using var connection = new SqliteConnection($"Data Source={dbPath};Mode=ReadOnly");
        connection.Open();

        try
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = "SELECT * FROM errors ORDER BY timestamp DESC LIMIT @limit";
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
                Console.WriteLine("No errors found.");
            }
            else
            {
                Console.WriteLine($"Last {rows.Count} errors:\n");
                Console.WriteLine(JsonSerializer.Serialize(rows, new JsonSerializerOptions { WriteIndented = true }));
            }
        }
        finally
        {
            connection.Close();
        }

        return 0;
    }
}
