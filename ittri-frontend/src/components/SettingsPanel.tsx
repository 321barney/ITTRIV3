// components/SettingsPanel.tsx
"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface SettingsPanelProps {
  format: "html" | "react";
  onFormatChange: (format: "html" | "react") => void;
  sections: string[];
  onSectionsChange: (sections: string[]) => void;
  brand: { name: string; primaryColor: string; font: string; logoUrl: string };
  onBrandChange: (brand: any) => void;
  temperature?: number;
  onTemperatureChange: (temp?: number) => void;
  maxTokens?: number;
  onMaxTokensChange: (tokens?: number) => void;
  streaming: boolean;
  useStreaming: boolean;
  onStreamingChange: (use: boolean) => void;
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    format,
    onFormatChange,
    sections,
    onSectionsChange,
    brand,
    onBrandChange,
    temperature,
    onTemperatureChange,
    maxTokens,
    onMaxTokensChange,
    streaming,
    useStreaming,
    onStreamingChange,
    expanded,
    onToggle,
    className,
  } = props;

  const availableSections = [
    "hero",
    "features",
    "social_proof",
    "pricing",
    "faq",
    "cta",
    "footer",
  ];

  const toggleSection = (s: string) => {
    const v = sections.includes(s)
      ? sections.filter((x) => x !== s)
      : [...sections, s];
    onSectionsChange(v);
  };

  const onBrandField = (key: keyof typeof brand, value: string) =>
    onBrandChange({ ...brand, [key]: value });

  return (
    <div className={cn("card-futuristic rounded-2xl p-5 space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight">Generation Settings</h3>
        <Button size="sm" variant="ghost" onClick={onToggle} className="rounded-lg">
          {expanded ? "Hide" : "Show"}
        </Button>
      </div>

      {!expanded ? null : (
        <div className="space-y-6">
          {/* Format & Streaming */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="glass rounded-xl border p-4">
              <Label className="mb-2 block text-xs">Format</Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={format === "html" ? "secondary" : "outline"}
                  className="rounded-lg"
                  onClick={() => onFormatChange("html")}
                  disabled={streaming}
                >
                  HTML
                </Button>
                <Button
                  size="sm"
                  variant={format === "react" ? "secondary" : "outline"}
                  className="rounded-lg"
                  onClick={() => onFormatChange("react")}
                  disabled={streaming}
                >
                  React
                </Button>
              </div>
            </div>

            <div className="glass rounded-xl border p-4">
              <Label className="mb-2 block text-xs">Streaming</Label>
              <div className="flex items-center gap-3">
                <Switch
                  checked={useStreaming}
                  onCheckedChange={(v) => onStreamingChange(v)}
                  disabled={streaming}
                />
                <span className="text-sm text-muted-foreground">
                  {useStreaming ? "On" : "Off"}
                </span>
              </div>
            </div>
          </div>

          {/* Sections */}
          <div className="glass rounded-xl border p-4">
            <Label className="mb-2 block text-xs">Page Sections</Label>
            <div className="flex flex-wrap gap-2">
              {availableSections.map((s) => {
                const active = sections.includes(s);
                return (
                  <Button
                    key={s}
                    size="sm"
                    variant={active ? "secondary" : "outline"}
                    className="rounded-lg capitalize"
                    onClick={() => toggleSection(s)}
                    disabled={streaming}
                  >
                    {s.replace("_", " ")}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Brand */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="glass rounded-xl border p-4 space-y-2">
              <Label className="text-xs">Brand Name</Label>
              <Input
                value={brand.name}
                onChange={(e) => onBrandField("name", e.target.value)}
                placeholder="Your Brand"
              />
            </div>

            <div className="glass rounded-xl border p-4 space-y-2">
              <Label className="text-xs">Primary Color</Label>
              <div className="flex gap-2">
                <input
                  type="color"
                  className={cn(
                    "h-10 w-12 cursor-pointer rounded-xl",
                    "bg-transparent glass border p-0"
                  )}
                  value={brand.primaryColor}
                  onChange={(e) => onBrandField("primaryColor", e.target.value)}
                  aria-label="Pick color"
                />
                <Input
                  value={brand.primaryColor}
                  onChange={(e) => onBrandField("primaryColor", e.target.value)}
                  placeholder="#00ffff"
                />
              </div>
            </div>

            <div className="glass rounded-xl border p-4 space-y-2">
              <Label className="text-xs">Logo URL</Label>
              <Input
                value={brand.logoUrl}
                onChange={(e) => onBrandField("logoUrl", e.target.value)}
                placeholder="https://…"
              />
            </div>

            <div className="glass rounded-xl border p-4 space-y-2">
              <Label className="text-xs">Font</Label>
              <Select
                value={brand.font}
                onChange={(e) => onBrandField("font", e.target.value)}
              >
                <option value="">System UI</option>
                <option value="Inter">Inter</option>
                <option value="Roboto">Roboto</option>
                <option value="SF Pro Display">SF Pro Display</option>
                <option value="Poppins">Poppins</option>
              </Select>
            </div>
          </div>

          {/* Model controls */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="glass rounded-xl border p-4 space-y-2">
              <Label className="text-xs">Temperature</Label>
              <Input
                type="number"
                step={0.1}
                min={0}
                max={2}
                value={temperature ?? ""}
                onChange={(e) =>
                  onTemperatureChange(
                    e.target.value === ""
                      ? undefined
                      : Math.max(0, Math.min(2, Number(e.target.value)))
                  )
                }
                placeholder="0.2"
              />
            </div>
            <div className="glass rounded-xl border p-4 space-y-2">
              <Label className="text-xs">Max Tokens</Label>
              <Input
                type="number"
                value={maxTokens ?? ""}
                onChange={(e) =>
                  onMaxTokensChange(
                    e.target.value === ""
                      ? undefined
                      : Math.max(1, Number(e.target.value))
                  )
                }
                placeholder="Auto"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
