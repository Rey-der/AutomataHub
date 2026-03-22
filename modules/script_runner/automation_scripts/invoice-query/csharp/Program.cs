/// <summary>
/// invoice-query — Displays stored invoices, filterable by vendor or date range.
/// C# variant for integration with .NET-based environments.
///
/// Environment variables:
///   VENDOR=Amazon        → filter by vendor name
///   FROM=2026-01-01      → date range start (inclusive)
///   TO=2026-12-31        → date range end (inclusive)
///
/// Outputs JSON to stdout for script_runner display.
/// </summary>

using System;
using System.Collections.Generic;
using System.Text.Json;
using Microsoft.Data.Sqlite;

class Program
{
    /// <summary>
    /// Entry point — queries invoices by vendor/date-range filters and outputs JSON.
    /// </summary>
    /// <param name="args">Command-line arguments (unused; filters come from env vars).</param>
    /// <returns>0 on success, 1 on error.</returns>
    static int Main(string[] args)
    {
        string? dbPath = Environment.GetEnvironmentVariable("SMART_DESKTOP_DB");
        if (string.IsNullOrEmpty(dbPath))
        {
            Console.Error.WriteLine("ERROR: SMART_DESKTOP_DB environment variable is not set.");
            return 1;
        }

        string? vendor = Environment.GetEnvironmentVariable("VENDOR");
        string? from = Environment.GetEnvironmentVariable("FROM");
        string? to = Environment.GetEnvironmentVariable("TO");

        try
        {
            using var connection = new SqliteConnection($"Data Source={dbPath};Mode=ReadOnly");
            connection.Open();

            using var cmd = connection.CreateCommand();
            string label;

            if (!string.IsNullOrEmpty(vendor))
            {
                cmd.CommandText = "SELECT * FROM invoices WHERE vendor = @vendor ORDER BY invoice_date DESC";
                cmd.Parameters.AddWithValue("@vendor", vendor);
                label = $"Invoices from vendor \"{vendor}\"";
            }
            else if (!string.IsNullOrEmpty(from) && !string.IsNullOrEmpty(to))
            {
                cmd.CommandText = "SELECT * FROM invoices WHERE invoice_date >= @from AND invoice_date <= @to ORDER BY invoice_date DESC";
                cmd.Parameters.AddWithValue("@from", from);
                cmd.Parameters.AddWithValue("@to", to);
                label = $"Invoices from {from} to {to}";
            }
            else
            {
                cmd.CommandText = "SELECT * FROM invoices ORDER BY invoice_date DESC";
                label = "All invoices";
            }

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
                Console.WriteLine($"{label}: none found.");
            }
            else
            {
                Console.WriteLine($"{label} ({rows.Count}):\n");
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
