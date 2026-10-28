// Node test-only resolver for the API's extensionless TypeScript source imports.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Preserve Node's normal resolution error for non-TypeScript imports.
    }
  }
  return nextResolve(specifier, context);
}
