/**
 * Script Runner — Dependency Resolver
 * Topological sort with cycle detection for workflow chaining.
 */

/**
 * Resolves the execution order for a script and all its transitive dependencies.
 * Returns an array of script IDs ordered so that dependencies come before dependents.
 *
 * @param {string} targetId - The script ID (folder name) to resolve
 * @param {(id: string) => object|null} getScript - Lookup function returning script objects with optional `dependsOn` arrays
 * @returns {string[]} Ordered array of script IDs (dependencies first, target last)
 * @throws {Error} On circular dependencies or missing dependency references
 */
function resolveExecutionOrder(targetId, getScript) {
  const visited = new Set();
  const order = [];

  function visit(scriptId, path) {
    if (visited.has(scriptId)) return;

    const cycleIdx = path.indexOf(scriptId);
    if (cycleIdx >= 0) {
      const cycle = path.slice(cycleIdx).concat(scriptId).join(' -> ');
      throw new Error(`Circular dependency detected: ${cycle}`);
    }

    const script = getScript(scriptId);
    if (!script) {
      throw new Error(`Dependency not found: "${scriptId}"`);
    }

    const deps = script.dependsOn || [];
    for (const depId of deps) {
      visit(depId, [...path, scriptId]);
    }

    visited.add(scriptId);
    order.push(scriptId);
  }

  visit(targetId, []);
  return order;
}

module.exports = { resolveExecutionOrder };
