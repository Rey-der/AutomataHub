/// <summary>
/// dashboard-summary — Aggregated stats for the Smart Desktop dashboard.
/// C# variant for integration with .NET-based environments.
///
/// Displays:
///   - Files sorted today
///   - Total invoices stored
///   - Automations run today
///   - Errors today
///   - Last backup status
///   - Executions today
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
    /// Entry point — aggregates dashboard stats from multiple tables and outputs JSON.
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

            string today = DateTime.UtcNow.ToString("yyyy-MM-dd");

            long filesSortedToday = QueryScalar(connection,
                "SELECT COUNT(*) FROM file_processing_records WHERE timestamp LIKE @d || '%'", today);

            long totalInvoices = QueryScalar(connection,
                "SELECT COUNT(*) FROM invoices");

            long automationsToday = QueryScalar(connection,
                "SELECT COUNT(*) FROM automation_logs WHERE timestamp LIKE @d || '%'", today);

            long errorsToday = QueryScalar(connection,
                "SELECT COUNT(*) FROM errors WHERE timestamp LIKE @d || '%'", today);

            long executionsToday = QueryScalar(connection,
                "SELECT COUNT(*) FROM execution_tracking WHERE start_time LIKE @d || '%'", today);

            // Last backup
            Dictionary<string, object?>? lastBackup = null;
            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = "SELECT backup_date, status, files_copied, files_skipped FROM backup_history ORDER BY backup_date DESC LIMIT 1";
                using var reader = cmd.ExecuteReader();
                if (reader.Read())
                {
                    lastBackup = new Dictionary<string, object?>();
                    for (int i = 0; i < reader.FieldCount; i++)
                        lastBackup[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                }
            }

            var summary = new Dictionary<string, object?>
            {
                ["date"] = today,
                ["files_sorted_today"] = filesSortedToday,
                ["total_invoices"] = totalInvoices,
                ["automations_today"] = automationsToday,
                ["executions_today"] = executionsToday,
                ["errors_today"] = errorsToday,
                ["last_backup"] = lastBackup
            };

            Console.WriteLine("Dashboard Summary:\n");
            Console.WriteLine(JsonSerializer.Serialize(summary, new JsonSerializerOptions { WriteIndented = true }));

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

    /// <summary>
    /// Executes a scalar COUNT query with an optional date parameter.
    /// </summary>
    /// <param name="conn">Open SQLite connection.</param>
    /// <param name="sql">SQL statement containing an optional @d parameter.</param>
    /// <param name="dateParam">Date string bound to @d (null if unused).</param>
    /// <returns>Scalar result as long.</returns>
    static long QueryScalar(SqliteConnection conn, string sql, string? dateParam = null)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql; // nosemgrep: csharp-sqli — all callers pass static SQL literals; @d parameters handle runtime values
        if (dateParam != null)
            cmd.Parameters.AddWithValue("@d", dateParam);
        return (long)(cmd.ExecuteScalar() ?? 0);
    }
}
