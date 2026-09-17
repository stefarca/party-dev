import { Button, FieldError, Form, Label, TextArea, TextField } from "@heroui/react";
import { useState } from "react";

import type { GameUiProps } from "../../shared/protocol";

// The generic proof that the engine works before any real game exists: a
// `<pre>` of the raw `view()` projection plus a
// textarea for a hand-typed JSON action. Reachable whenever no UI is
// registered for a game (games/registry.ts's `gameUi` map), and stays in
// the tree afterwards as a debugging aid for whatever isn't registered yet.
export function DebugGameView({ view, waitingOn, deadline, result, send }: GameUiProps) {
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  function submit() {
    let action: unknown;
    try {
      action = text.trim() === "" ? undefined : JSON.parse(text);
    } catch {
      setParseError("Enter a valid JSON action (or leave blank).");
      return;
    }
    setParseError(null);
    send(action);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-muted italic">
        No UI is registered for this game — showing the raw engine view.
      </p>
      <pre className="m-0 overflow-auto rounded-md bg-[var(--surface-inset)] p-3 font-mono text-sm text-foreground">
        {JSON.stringify({ view, waitingOn, deadline, result }, null, 2)}
      </pre>
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-2"
      >
        <TextField value={text} onChange={setText} isInvalid={!!parseError}>
          <Label>Action (JSON)</Label>
          <TextArea rows={3} placeholder={'{"t":"increment"}'} className="font-mono" />
          {parseError && <FieldError>{parseError}</FieldError>}
        </TextField>
        <Button type="submit">Send</Button>
      </Form>
    </div>
  );
}
