/**
 * Fuentes canónicas por dominio (verificadas en investigación 2026-09).
 * Usado por `ctx7max add --pack <dominio>` y por scripts/seed-domains.mts.
 * Cada entrada es una fuente soportada por el pipeline: github/llmstxt/website/wiki/etc.
 */
export const DOMAIN_SOURCES: Record<string, string[]> = {
  "web-backend": [
    "https://github.com/honojs/hono",
    "https://github.com/fastify/fastify",
    "https://github.com/expressjs/express",
    "https://github.com/trpc/trpc",
  ],
  android: [
    "https://github.com/android/nowinandroid",
    "https://github.com/android/compose-samples",
    "https://github.com/android/architecture-samples",
    "https://github.com/android/tv-samples",
    "https://github.com/android/wear-os-samples",
    "https://github.com/android/user-interface-samples",
    "https://github.com/googlecodelabs/android-compose-codelabs",
  ],
  "ios-macos": [
    "https://github.com/swiftlang/swift-book",
    "https://github.com/swiftlang/swift-evolution",
    "https://github.com/pointfreeco/swift-composable-architecture",
    "https://developer.apple.com/documentation/swiftui",
    "https://developer.apple.com/documentation/appkit",
  ],
  "mobile-multiplatform": [
    "https://github.com/flutter/website",
    "https://github.com/react/react-native-website",
    "https://github.com/expo/expo",
    "https://github.com/JetBrains/kotlin-web-site",
    "https://github.com/dotnet/docs-maui",
  ],
  desktop: [
    "https://github.com/MicrosoftDocs/windows-dev-docs",
    "https://github.com/MicrosoftDocs/win32",
    "https://github.com/microsoft/microsoft-ui-xaml",
    "https://github.com/electron/electron",
    "https://github.com/tauri-apps/tauri-docs",
    "https://github.com/flatpak/flatpak-docs",
  ],
  gamedev: [
    "https://github.com/godotengine/godot-docs",
    "https://github.com/KhronosGroup/Vulkan-Docs",
    "https://github.com/JoeyDeVries/LearnOpenGL",
    "https://github.com/patriciogonzalezvivo/thebookofshaders",
    "https://github.com/munificent/game-programming-patterns",
    "https://dev.epicgames.com/llms.txt",
  ],
  "consoles-homebrew": [
    "https://github.com/OpenOrbis/OpenOrbis-PS4-Toolchain",
    "https://github.com/switchbrew/libnx",
    "https://github.com/devkitPro/installer",
    "https://switchbrew.org/wiki",
    "https://www.psdevwiki.com",
  ],
  tv: [
    "https://github.com/Samsung/tizen-docs",
    "https://webostv.developer.lge.com",
    "https://developer.samsung.com/smarttv/develop/overview.html",
    "https://developer.android.com/training/tv",
  ],
  wearables: [
    "https://developer.android.com/wear",
    "https://github.com/google/horologist",
    "https://developer.apple.com/documentation/watchkit",
  ],
  osdev: [
    "https://github.com/phil-opp/blog_os",
    "https://github.com/cfenollosa/os-tutorial",
    "https://github.com/0xAX/linux-insides",
    "https://github.com/sysprog21/lkmpg",
    "https://github.com/mit-pdos/xv6-riscv",
    "https://github.com/SerenityOS/serenity",
    "https://wiki.osdev.org",
  ],
  "kernel-drivers": [
    "https://github.com/torvalds/linux#Documentation",
    "https://github.com/bootlin/training-materials",
    "https://www.kernel.org/doc/html/latest/",
  ],
  embedded: [
    "https://github.com/raspberrypi/documentation",
    "https://github.com/raspberrypi/pico-sdk",
    "https://github.com/zephyrproject-rtos/zephyr",
    "https://github.com/embassy-rs/embassy",
    "https://github.com/espressif/esp-idf",
    "https://github.com/riscv/riscv-isa-manual",
    "https://github.com/FreeRTOS/FreeRTOS",
  ],
  "linux-distros": [
    "https://github.com/CachyOS/wiki",
    "https://github.com/CachyOS/linux-cachyos",
    "https://wiki.archlinux.org",
    "https://wiki.gentoo.org",
    "https://www.linuxfromscratch.org",
  ],
};

export type DomainPack = keyof typeof DOMAIN_SOURCES;
