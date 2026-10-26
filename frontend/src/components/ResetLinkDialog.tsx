import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { ResetLink } from "../lib/types";
import { formatDateTime } from "../lib/format";
import { Alert, Button, Modal } from "./ui";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button size="sm" variant="secondary" onClick={copy} className="shrink-0">
      {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function ResetLinkDialog({
  label,
  reset,
  onClose,
}: {
  label: string | null;
  reset: ResetLink | null;
  onClose: () => void;
}) {
  const open = label !== null && reset !== null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Password reset link"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {reset && label && (
        <div className="space-y-3">
          <Alert tone="warning" title="Shown only once">
            Share this link privately with {label}. It works a single time and expires{" "}
            {formatDateTime(reset.expires_at)}. Issuing another link cancels this one.
          </Alert>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
            <code className="min-w-0 flex-1 break-all text-xs text-slate-700">{reset.reset_url}</code>
            <CopyButton value={reset.reset_url} />
          </div>
        </div>
      )}
    </Modal>
  );
}
