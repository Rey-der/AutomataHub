/// <summary>
/// backup-runner — Copies configured folders to a backup location.
/// C# variant for integration with .NET-based environments.
///
/// Environment variables:
///   BACKUP_FOLDERS — comma-separated list of absolute folder paths to back up
///   BACKUP_DEST   — destination directory (default: ~/Backups)
///
/// Writes:
///   - backup_history (one summary row per run)
///   - automation_logs (start, progress, end)
///   - execution_tracking (start → finish)
///   - errors (on failure)
/// </summary>

using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using Microsoft.Data.Sqlite;

class Program
{
    static int _copied = 0;
    static int _skipped = 0;

    /// <summary>
    /// Entry point — copies configured folders to a backup destination and logs results.
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

        string? foldersEnv = Environment.GetEnvironmentVariable("BACKUP_FOLDERS");
        string backupDest = Environment.GetEnvironmentVariable("BACKUP_DEST")
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Backups");

        if (string.IsNullOrEmpty(foldersEnv))
        {
            Console.Error.WriteLine("ERROR: BACKUP_FOLDERS environment variable is not set.");
            Console.Error.WriteLine("Set it to a comma-separated list of folders to back up.");
            return 1;
        }

        var folders = foldersEnv.Split(',').Select(f => f.Trim()).Where(f => f.Length > 0).ToArray();

        foreach (var folder in folders)
        {
            if (!Directory.Exists(folder))
            {
                Console.Error.WriteLine($"Source folder not found: {folder}");
                return 1;
            }
        }

        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();

        string scriptName = "backup-runner";
        string startTime = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");

        // Insert execution_tracking start
        long executionId;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "INSERT INTO execution_tracking (script, start_time) VALUES (@script, @start)";
            cmd.Parameters.AddWithValue("@script", scriptName);
            cmd.Parameters.AddWithValue("@start", startTime);
            cmd.ExecuteNonQuery();
            executionId = (long)new SqliteCommand("SELECT last_insert_rowid()", connection).ExecuteScalar()!;
        }

        // Log start
        InsertLog(connection, scriptName, "INFO", $"Backing up {folders.Length} folder(s) to {backupDest}");

        try
        {
            if (!Directory.Exists(backupDest))
                Directory.CreateDirectory(backupDest);

            int totalCopied = 0;
            int totalSkipped = 0;
            string status = "SUCCESS";

            foreach (var folder in folders)
            {
                string folderName = Path.GetFileName(folder);
                string dest = Path.Combine(backupDest, folderName);

                try
                {
                    _copied = 0;
                    _skipped = 0;
                    CopyDirectory(folder, dest);
                    totalCopied += _copied;
                    totalSkipped += _skipped;
                    InsertLog(connection, scriptName, "INFO", $"{folderName}: {_copied} copied, {_skipped} skipped");
                }
                catch (IOException ex)
                {
                    InsertLog(connection, scriptName, "ERROR", $"I/O failure backing up {folderName}: {ex.Message}");
                    status = "PARTIAL";
                }
                catch (Exception ex)
                {
                    InsertLog(connection, scriptName, "ERROR", $"Failed to back up {folderName}: {ex.Message}");
                    status = "PARTIAL";
                }
            }

            var folderNames = folders.Select(Path.GetFileName).ToArray();

            // Insert backup_history
            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = @"INSERT INTO backup_history (folders, files_copied, files_skipped, backup_location, status)
                                    VALUES (@folders, @copied, @skipped, @location, @status)";
                cmd.Parameters.AddWithValue("@folders", JsonSerializer.Serialize(folderNames));
                cmd.Parameters.AddWithValue("@copied", totalCopied);
                cmd.Parameters.AddWithValue("@skipped", totalSkipped);
                cmd.Parameters.AddWithValue("@location", backupDest);
                cmd.Parameters.AddWithValue("@status", status);
                cmd.ExecuteNonQuery();
            }

            InsertLog(connection, scriptName, "SUCCESS", $"Backup complete: {totalCopied} copied, {totalSkipped} skipped");

            FinishExecution(connection, executionId, status);

            var result = new { folders = folderNames, files_copied = totalCopied, files_skipped = totalSkipped, backup_location = backupDest, status };
            Console.WriteLine("Backup complete.\n");
            Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
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
    /// Recursively copies files from <paramref name="src"/> to <paramref name="dest"/>,
    /// skipping hidden files and files that are already up-to-date.
    /// </summary>
    /// <param name="src">Source directory path.</param>
    /// <param name="dest">Destination directory path.</param>
    static void CopyDirectory(string src, string dest)
    {
        if (!Directory.Exists(dest))
            Directory.CreateDirectory(dest);

        foreach (var file in Directory.GetFiles(src))
        {
            string name = Path.GetFileName(file);
            if (name.StartsWith(".")) continue;

            string destFile = Path.Combine(dest, name);
            var srcInfo = new FileInfo(file);

            if (File.Exists(destFile))
            {
                var destInfo = new FileInfo(destFile);
                if (destInfo.Length == srcInfo.Length &&
                    Math.Abs((destInfo.LastWriteTimeUtc - srcInfo.LastWriteTimeUtc).TotalSeconds) < 1)
                {
                    _skipped++;
                    continue;
                }
            }

            File.Copy(file, destFile, overwrite: true);
            File.SetLastWriteTimeUtc(destFile, srcInfo.LastWriteTimeUtc);
            _copied++;
        }

        foreach (var dir in Directory.GetDirectories(src))
        {
            string name = Path.GetFileName(dir);
            if (name.StartsWith(".")) continue;
            CopyDirectory(dir, Path.Combine(dest, name));
        }
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
