/// <summary>
/// download-sorter — Sorts files in ~/Downloads into categorised subfolders.
/// C# variant for integration with .NET-based environments.
///
/// Categories (by extension):
///   Images, Documents, Archives, Audio, Video, Code, Other
///
/// Environment variables:
///   DOWNLOADS_DIR — source folder (default: ~/Downloads)
///   DRY_RUN=1    — print what would happen without moving files
///
/// Writes:
///   - file_processing_records (one per file)
///   - automation_logs (start, per-category summary, end)
///   - execution_tracking (start → finish)
///   - errors (on failure)
/// </summary>

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Microsoft.Data.Sqlite;

class Program
{
    static readonly Dictionary<string, string[]> Categories = new()
    {
        ["Images"]    = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".ico", ".tiff" },
        ["Documents"] = new[] { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".rtf", ".odt", ".csv" },
        ["Archives"]  = new[] { ".zip", ".tar", ".gz", ".7z", ".rar", ".bz2", ".xz", ".dmg", ".iso" },
        ["Audio"]     = new[] { ".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma" },
        ["Video"]     = new[] { ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm" },
        ["Code"]      = new[] { ".js", ".ts", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".css", ".html", ".json", ".xml", ".yaml", ".yml", ".sh", ".md" },
    };

    static string Categorise(string ext)
    {
        string lower = ext.ToLowerInvariant();
        foreach (var (category, exts) in Categories)
        {
            if (exts.Contains(lower)) return category;
        }
        return "Other";
    }

    static int Main(string[] args)
    {
        string? dbPath = Environment.GetEnvironmentVariable("SMART_DESKTOP_DB");
        if (string.IsNullOrEmpty(dbPath))
        {
            Console.Error.WriteLine("ERROR: SMART_DESKTOP_DB environment variable is not set.");
            return 1;
        }

        string downloadsDir = Environment.GetEnvironmentVariable("DOWNLOADS_DIR")
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        bool dryRun = Environment.GetEnvironmentVariable("DRY_RUN") == "1";

        if (!Directory.Exists(downloadsDir))
        {
            Console.Error.WriteLine($"Downloads directory not found: {downloadsDir}");
            return 1;
        }

        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();

        string scriptName = "download-sorter";
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

        InsertLog(connection, scriptName, "INFO", $"Scanning {downloadsDir}" + (dryRun ? " (DRY RUN)" : ""));

        try
        {
            var files = Directory.GetFiles(downloadsDir)
                .Select(f => new FileInfo(f))
                .Where(f => !f.Name.StartsWith("."))
                .ToArray();

            if (files.Length == 0)
            {
                InsertLog(connection, scriptName, "INFO", "No files to sort.");
                FinishExecution(connection, executionId, "SUCCESS");
                var emptyResult = new { sorted = 0, skipped = 0 };
                Console.WriteLine(JsonSerializer.Serialize(emptyResult, new JsonSerializerOptions { WriteIndented = true }));
                return 0;
            }

            int sorted = 0;
            int skipped = 0;
            var categoryCounts = new Dictionary<string, int>();

            foreach (var file in files)
            {
                string ext = file.Extension;
                string category = Categorise(ext);
                string destDir = Path.Combine(downloadsDir, category);
                string destPath = Path.Combine(destDir, file.Name);

                if (File.Exists(destPath))
                {
                    InsertFileRecord(connection, scriptName, file.FullName, null, string.IsNullOrEmpty(ext) ? "none" : ext, "skip");
                    skipped++;
                    continue;
                }

                if (!dryRun)
                {
                    if (!Directory.Exists(destDir))
                        Directory.CreateDirectory(destDir);
                    File.Move(file.FullName, destPath);
                }

                InsertFileRecord(connection, scriptName, file.FullName, destPath, string.IsNullOrEmpty(ext) ? "none" : ext, "sort");

                categoryCounts[category] = categoryCounts.GetValueOrDefault(category) + 1;
                sorted++;
            }

            InsertLog(connection, scriptName, "SUCCESS", $"Sorted {sorted} files, skipped {skipped}");
            FinishExecution(connection, executionId, "SUCCESS");

            Console.WriteLine(dryRun ? "DRY RUN — no files moved.\n" : "Sort complete.\n");
            var result = new { sorted, skipped, categoryCounts };
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

    static void InsertLog(SqliteConnection conn, string script, string status, string message)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO automation_logs (script, status, message) VALUES (@script, @status, @msg)";
        cmd.Parameters.AddWithValue("@script", script);
        cmd.Parameters.AddWithValue("@status", status);
        cmd.Parameters.AddWithValue("@msg", message);
        cmd.ExecuteNonQuery();
    }

    static void InsertFileRecord(SqliteConnection conn, string script, string source, string? dest, string fileType, string operation)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"INSERT INTO file_processing_records (source_path, dest_path, file_type, script, operation)
                            VALUES (@source, @dest, @type, @script, @op)";
        cmd.Parameters.AddWithValue("@source", source);
        cmd.Parameters.AddWithValue("@dest", (object?)dest ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@type", fileType);
        cmd.Parameters.AddWithValue("@script", script);
        cmd.Parameters.AddWithValue("@op", operation);
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
