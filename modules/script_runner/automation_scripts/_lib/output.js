/**
 * Shared output helper for automation scripts.
 *
 * Provides formatted JSON output to stdout, matching the
 * convention expected by the script runner terminal display.
 */

function printJSON(data) {
  console.log(JSON.stringify(data, null, 2));
}

module.exports = { printJSON };
