// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  applyStoredTheme,
  applyThemeChoice,
  DEFAULT_THEME_CHOICE,
  loadThemeChoice,
  parseThemeChoice,
  resolveEffectiveTheme,
  storeThemeChoice,
  THEME_STORAGE_KEY,
} from "./theme.js";

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme choice", () => {
  it("defaults to system for missing or malformed values", () => {
    expect(parseThemeChoice(null)).toBe(DEFAULT_THEME_CHOICE);
    expect(parseThemeChoice("midnight")).toBe("system");
    expect(parseThemeChoice("")).toBe("system");
    expect(parseThemeChoice("LIGHT")).toBe("system");
  });

  it("restores each valid stored choice", () => {
    expect(parseThemeChoice("light")).toBe("light");
    expect(parseThemeChoice("dark")).toBe("dark");
    expect(parseThemeChoice("system")).toBe("system");
  });

  it("resolves the effective theme from the OS preference", () => {
    expect(resolveEffectiveTheme("light", true)).toBe("light");
    expect(resolveEffectiveTheme("dark", false)).toBe("dark");
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
  });

  it("persists the choice and applies data-theme without a custom-property write", () => {
    storeThemeChoice("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(loadThemeChoice()).toBe("dark");

    applyThemeChoice("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    applyThemeChoice("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    applyThemeChoice("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("applies the stored choice on bootstrap", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(applyStoredTheme()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
