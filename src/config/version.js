// src/config/version.js
// Fuente única de verdad para la versión del sistema: package.json.
// Para publicar una versión nueva: `npm version patch --no-git-tag-version`.
// Import con nombre: Vite solo incluye "version" en el bundle, no todo package.json.
import { version } from '../../package.json';

export const APP_VERSION = version;
export const APP_NAME = 'Donde Juancho POS';
export const APP_FULL_NAME = `${APP_NAME} v${APP_VERSION}`;
