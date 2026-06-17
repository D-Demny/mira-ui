# mira-ui

Frontend for Mira, a custom firmware for the Spotify Car Thing controller designed to be as stand alone as possible.

React + TypeScript + Vite.

See the related projects:

- **mira-daemon** - the on-device daemon that talks to Spotify
- **mira-firmware** - the firmware build pipeline
- **thing-releases** - firmware images

## Development

| Command                 | Purpose                     |
| ----------------------- | --------------------------- |
| `npm run dev`           | Vite dev server with HMR    |
| `npm run build`         | Production build to `dist/` |
| `npm run lint`          | ESLint                      |
| `npm run typecheck`     | `tsc -b --noEmit`           |
| `npm test`              | Run vitest suite            |
| `npm run test:watch`    | Vitest in watch mode        |
| `npm run test:coverage` | Coverage report             |

screen switcher is available when holding down the (`` ` ``) key for iterating on individual UI states without a live daemon.

### Browser target

The Car Thing's Chromium is Chrome 69 (2018), so the production bundle uses `@vitejs/plugin-legacy` to emit a compatible build. The modern bundle is disabled in `vite.config.ts` since it's never shipped.

## License

Apache 2.0 see [LICENSE](LICENSE).
