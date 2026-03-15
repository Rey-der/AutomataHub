/*
 * hello-csharp — Minimal C# script to verify .csx support in AutomataHub.
 */

Console.WriteLine("Hello from C# scripting!");
Console.WriteLine($"  Runtime: {System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}");
Console.WriteLine($"  OS:      {System.Runtime.InteropServices.RuntimeInformation.OSDescription}");
Console.WriteLine($"  Time:    {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
Console.WriteLine($"  Working Dir: {Environment.CurrentDirectory}");

var homeDir = Environment.GetEnvironmentVariable("HOME");
if (!string.IsNullOrEmpty(homeDir))
{
    Console.WriteLine($"  Home: {homeDir}");
}

Console.WriteLine("\nC# script execution successful.");
