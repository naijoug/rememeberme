# Frontend

Frontend clients live under this directory.

## Applications

```text
frontend/
├── browser-extension/  # WXT / Vue 3 / TypeScript
├── apple/              # macOS/iOS targets and shared Swift packages
└── designs/            # Static HTML/style/image/design references
```

Add future mobile and desktop clients as sibling directories, for example `frontend/mobile/` or `frontend/desktop/`, so each frontend surface can keep its own runtime, dependencies, build output, and documentation.

The proposed website is described in the [Cloudflare implementation plan](../docs/cloudflare-implementation-plan.md); `frontend/website/` has not been implemented. Native Apple targets and shared packages now exist under `apple/`, with local foundations implemented and later milestones pending. See the [Apple README](apple/README.md) and [implementation plan](../docs/apple-clients-implementation-plan.md). Designs under `designs/` are product references, not runnable clients. The extension's component preview may use reference images but uses disposable sample vocabulary.

## Browser Extension

See [browser-extension/README.md](browser-extension/README.md) for setup and release instructions.

Run npm commands inside that package. Its `entrypoints/`, `components/`, `services/` and `types/` own the current runtime; its `.wxt/`, `.output/` and `node_modules/` are generated or installed locally. See the [project architecture](../docs/architecture.md) and [extension architecture](browser-extension/docs/architecture.md) for responsibilities and data flow.
