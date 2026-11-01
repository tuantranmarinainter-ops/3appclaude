// Test-only launcher options. Never select a system browser implicitly.
export function browserOptions(
  options = {},
  environment = process.env,
  platform = process.platform,
) {
  const { executablePath: ignored, ...rest } = options;
  return {
    ...rest,
    ...(environment.CHROMIUM_PATH ? { executablePath: environment.CHROMIUM_PATH } : {}),
    args: [
      ...new Set([
        ...(options.args || []),
        ...(platform === 'linux'
          ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
          : []),
      ]),
    ],
  };
}
