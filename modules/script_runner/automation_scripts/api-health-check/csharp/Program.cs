/// <summary>
/// api-health-check — Pings HTTP endpoints and records status, latency, and errors.
/// C# variant for integration with .NET-based environments.
///
/// Environment variables:
///   HEALTH_CHECK_URLS — comma-separated list of URLs to probe
///   HEALTH_CHECK_TIMEOUT — request timeout in seconds (default: 10)
///
/// Writes:
///   - automation_logs (one row per endpoint + summary)
///   - execution_tracking (start → finish)
///   - errors (on failure)
/// </summary>

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;

class Program
{
    /// <summary>
    /// Entry point — probes each URL and logs results to the database.
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

        string? urlsEnv = Environment.GetEnvironmentVariable("HEALTH_CHECK_URLS");
        if (string.IsNullOrEmpty(urlsEnv))
        {
            Console.Error.WriteLine("ERROR: HEALTH_CHECK_URLS environment variable is not set.");
            Console.Error.WriteLine("Set it to a comma-separated list of URLs to check.");
            return 1;
        }

        int timeoutSec = 10;
        string? timeoutEnv = Environment.GetEnvironmentVariable("HEALTH_CHECK_TIMEOUT");
        if (!string.IsNullOrEmpty(timeoutEnv) && int.TryParse(timeoutEnv, out int parsed) && parsed > 0)
            timeoutSec = parsed;

        var urls = urlsEnv.Split(',').Select(u => u.Trim()).Where(u => u.Length > 0).ToArray();

        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();

        string scriptName = "api-health-check";
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

        InsertLog(connection, scriptName, "INFO", $"Checking {urls.Length} endpoint(s), timeout {timeoutSec}s");

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(timeoutSec) };
            var results = new List<Dictionary<string, object?>>();
            int healthy = 0;
            int unhealthy = 0;

            foreach (var url in urls)
            {
                var entry = ProbeEndpoint(client, url);
                results.Add(entry);

                bool ok = entry["status"] is int code && code >= 200 && code < 400;
                if (ok)
                    healthy++;
                else
                    unhealthy++;

                string level = ok ? "INFO" : "ERROR";
                InsertLog(connection, scriptName, level,
                    $"{url} — {entry["status"]} ({entry["latency_ms"]}ms)");
            }

            InsertLog(connection, scriptName, "SUCCESS",
                $"Done: {healthy} healthy, {unhealthy} unhealthy");
            FinishExecution(connection, executionId, unhealthy == 0 ? "SUCCESS" : "PARTIAL");

            Console.WriteLine("Health Check Results:\n");
            var summary = new { healthy, unhealthy, endpoints = results };
            Console.WriteLine(JsonSerializer.Serialize(summary, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (IOException ex)
        {
            InsertError(connection, scriptName, ex);
            FinishExecution(connection, executionId, "FAIL", ex.Message);
            Console.Error.WriteLine($"I/O error: {ex.Message}");
            return 1;
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
    /// Sends a GET request to the given URL and returns status, latency, and any error.
    /// </summary>
    /// <param name="client">Configured HttpClient instance.</param>
    /// <param name="url">Endpoint URL to probe.</param>
    /// <returns>Dictionary with url, status, latency_ms, and error keys.</returns>
    static Dictionary<string, object?> ProbeEndpoint(HttpClient client, string url)
    {
        var entry = new Dictionary<string, object?> { ["url"] = url };
        var sw = Stopwatch.StartNew();

        try
        {
            using var response = client.GetAsync(url).GetAwaiter().GetResult();
            sw.Stop();
            entry["status"] = (int)response.StatusCode;
            entry["latency_ms"] = sw.ElapsedMilliseconds;
            entry["error"] = null;
        }
        catch (TaskCanceledException)
        {
            sw.Stop();
            entry["status"] = "TIMEOUT";
            entry["latency_ms"] = sw.ElapsedMilliseconds;
            entry["error"] = "Request timed out";
        }
        catch (HttpRequestException ex)
        {
            sw.Stop();
            entry["status"] = "ERROR";
            entry["latency_ms"] = sw.ElapsedMilliseconds;
            entry["error"] = ex.Message;
        }

        return entry;
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
    /// <param name="status">Final status (SUCCESS, PARTIAL, FAIL).</param>
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
