import "./src/services/polyfills"; // Web Crypto para Hermes (ANTES que todo)

import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
