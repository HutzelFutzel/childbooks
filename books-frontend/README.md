# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Prerequisites

- **Node.js**: Ensure you are using a compatible Node.js version (e.g., v24.x LTS). You can use `nvm` to manage versions.
- **Yarn**: Used for managing frontend dependencies.
- **Rust & Cargo**: Required for building the Tauri macOS application. You can install it via [rustup](https://rustup.rs/): 
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```

## Installation

Install the required frontend dependencies using Yarn:

```bash
yarn install
```

## Running for Development

### 1. Web Application Only

To run just the React frontend in your browser (useful for fast UI development without compiling the Rust backend):

```bash
yarn dev
```
This will start a local development server (usually accessible at `http://localhost:1420`).

### 2. macOS Application (Tauri)

To run the React app wrapped inside the native macOS application window:

```bash
yarn tauri dev
```
*Note: The first time you run this, Cargo will download and compile the Rust backend, which might take a few minutes.*

## Building for Production

### 1. Build the Web Application

To build just the standalone React frontend for web hosting:

```bash
yarn build
```
The compiled web assets will be located in the `dist/` directory.

### 2. Build the macOS Application

To build the standalone macOS `.app` bundle and `.dmg` installer:

```bash
yarn tauri build
```

Once the build is complete, you can find your compiled macOS application inside the `src-tauri/target/release/bundle/` directory:
- **macOS App Bundle**: `src-tauri/target/release/bundle/macos/` (You can double-click the `.app` file here to run it, or drag it to your Applications folder).
- **DMG Installer**: `src-tauri/target/release/bundle/dmg/` (Useful for distributing your app to others).

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
