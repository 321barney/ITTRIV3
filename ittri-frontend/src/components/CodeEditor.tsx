// components/CodeEditor.tsx
"use client";

import React, { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RefreshCw, Copy, Eye, Save } from "lucide-react";
import { cn } from "@/lib/utils";

interface CodeEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  format: "html" | "react";
  activeTab: "preview" | "code";
  onTabChange: (tab: "preview" | "code") => void;
  onRun: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onOpenTab: () => void;
  previewHtml: string;
}

export function CodeEditor({
  code,
  onCodeChange,
  format,
  activeTab,
  onTabChange,
  onRun,
  onCopy,
  onDownload,
  onOpenTab,
  previewHtml,
}: CodeEditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (iframeRef.current) {
      iframeRef.current.srcdoc = previewHtml;
    }
  }, [previewHtml]);

  return (
    <div className="card-futuristic rounded-2xl p-4 sm:p-5 space-y-3">
      {/* Header / Tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold tracking-tight">Workspace</h2>

          {/* Tabs */}
          <div className="glass rounded-xl p-0.5 border">
            <div className="flex">
              <Button
                size="sm"
                variant={activeTab === "preview" ? "secondary" : "ghost"}
                className="rounded-lg"
                onClick={() => onTabChange("preview")}
              >
                Preview
              </Button>
              <Button
                size="sm"
                variant={activeTab === "code" ? "secondary" : "ghost"}
                className="rounded-lg"
                onClick={() => onTabChange("code")}
              >
                Code
              </Button>
            </div>
          </div>

          <Badge variant="outline" className="px-2 py-1 text-xs">
            {format.toUpperCase()}
          </Badge>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" className="rounded-xl" onClick={onRun}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Run
          </Button>
          <Button size="sm" variant="secondary" className="rounded-xl" onClick={onCopy}>
            <Copy className="mr-2 h-4 w-4" />
            Copy
          </Button>
          <Button size="sm" variant="secondary" className="rounded-xl" onClick={onDownload}>
            <Save className="mr-2 h-4 w-4" />
            Download
          </Button>
          <Button size="sm" variant="secondary" className="rounded-xl" onClick={onOpenTab}>
            <Eye className="mr-2 h-4 w-4" />
            Open
          </Button>
        </div>
      </div>

      {/* Body */}
      {activeTab === "preview" ? (
        <div className={cn(
          "h-[72vh] w-full overflow-hidden rounded-xl",
          "glass border"
        )}>
          <iframe
            ref={iframeRef}
            title="Landing Preview"
            sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
            className="h-full w-full rounded-lg"
          />
        </div>
      ) : (
        <div className="flex h-[72vh] w-full flex-col rounded-xl glass border p-2">
          <Textarea
            className={cn(
              "min-h-0 flex-1 font-mono text-sm leading-5 custom-scrollbar",
              "focus-neon"
            )}
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder={format === "react" ? "// Paste TSX" : "<!-- HTML here -->"}
          />
          <div className="pt-1 text-xs text-muted-foreground">
            Editing {format.toUpperCase()} source
          </div>
        </div>
      )}
    </div>
  );
}
