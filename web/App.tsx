import { useState } from "react";
import type { FormEvent } from "react";

import { Button, Form, I18nProvider, Input, Label, Popover, TextField } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { NICKNAME_MAX_LENGTH } from "../shared/nickname";
import { AppBackground } from "./components/AppBackground";
import { LanguagePicker } from "./components/LanguagePicker";
import { PlayerAvatar } from "./components/PlayerAvatar";
import { Spinner } from "./components/states";
import { ThemeToggle } from "./components/ThemeToggle";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { WordMark } from "./components/WordMark";
import { errorText } from "./errors";
import { useLanguage } from "./i18n";
import { Dashboard } from "./routes/Dashboard";
import { MatchPage } from "./routes/MatchPage";
import { NicknameGate } from "./routes/NicknameGate";
import { navigate, useRoute } from "./router";
import { SessionProvider, useSession } from "./session";

// The nickname is the account, so this one control covers both things a
// player can do with it: move their own player onto a different nickname
// (keeping every match), or end the session so someone else can sign in on
// this device. Renaming into a nickname somebody else holds is refused by
// the server — signing out is the way to switch into it deliberately.
function RenameControl() {
  const { t } = useTranslation();
  const { player, rename, signOut } = useSession();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(player?.nickname ?? "");
  const [error, setError] = useState<string | null>(null);

  if (!player) return null;
  const nickname = player.nickname;

  function setOpen(open: boolean) {
    setEditing(open);
    if (open) {
      setValue(nickname);
      setError(null);
    }
  }

  async function handleRename(e: FormEvent) {
    e.preventDefault();
    try {
      await rename(value);
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(errorText(t, err, t("rename.failed")));
    }
  }

  async function handleSignOut() {
    try {
      await signOut();
    } catch (err) {
      setError(errorText(t, err, t("rename.signOutFailed")));
    }
  }

  return (
    <Popover isOpen={editing} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("rename.trigger", { nickname })}
        className="max-w-32 min-w-0 shrink gap-2 rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--surface-2)] pr-3 pl-1 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] hover:scale-105 sm:max-w-none"
      >
        <PlayerAvatar id={player.playerId} nickname={nickname} size="sm" />
        <span className="truncate text-sm font-bold">{nickname}</span>
      </Button>
      <Popover.Content placement="bottom end">
        <Popover.Dialog aria-label={t("rename.dialog")}>
          <Form onSubmit={handleRename} className="flex w-60 flex-col gap-3 p-4">
            <TextField value={value} onChange={setValue} maxLength={NICKNAME_MAX_LENGTH}>
              <Label className="text-xs font-bold text-[var(--text-muted)]">
                {t("rename.label")}
              </Label>
              <Input autoFocus />
            </TextField>
            <p className="m-0 text-xs text-[var(--text-muted)]">{t("rename.hint")}</p>
            {error && (
              <p role="alert" className="m-0 text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm">
                {t("rename.save")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onPress={() => setOpen(false)}>
                {t("rename.cancel")}
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onPress={handleSignOut}
              className="mt-1 self-start border-t border-[var(--border-subtle)] text-[var(--text-muted)]"
            >
              {t("rename.signOut")}
            </Button>
          </Form>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--surface-void)]/75 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <a
          href="/"
          className="group inline-flex items-center gap-2 font-display text-lg font-bold text-[var(--text-primary)] no-underline"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <WordMark
            animated
            className="size-7 text-accent transition-transform duration-[var(--dur-base)] ease-[var(--ease-bounce)] group-hover:rotate-12 group-hover:scale-110"
          />
          <span>party</span>
        </a>
        {/* `min-w-0` lets the nickname button truncate instead of pushing the row past a
            phone's width. */}
        <div className="flex min-w-0 items-center gap-2">
          <RenameControl />
          <LanguagePicker />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function RouteContent() {
  const { t } = useTranslation();
  const route = useRoute();
  if (route.name === "dashboard") return <Dashboard />;
  if (route.name === "match") return <MatchPage code={route.code} />;
  return (
    <main id="main-content" className="app-container">
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <WordMark animated className="size-14 text-accent opacity-60" />
        <h1 className="m-0 font-display text-2xl font-bold">{t("notFound.title")}</h1>
        <p className="m-0 text-[var(--text-muted)]">{t("notFound.body")}</p>
        <Button onPress={() => navigate("/")}>{t("notFound.back")}</Button>
      </div>
    </main>
  );
}

function AppShell() {
  const { t } = useTranslation();
  const { state } = useSession();

  if (state === "loading") {
    return (
      <main
        id="main-content"
        className="flex min-h-dvh animate-in flex-col items-center justify-center gap-5 duration-500 fade-in"
      >
        <WordMark animated className="size-14 text-accent" />
        <Spinner label={t("app.loading")} />
      </main>
    );
  }

  if (state === "anon") {
    return <NicknameGate />;
  }

  return (
    <>
      <Header />
      <RouteContent />
    </>
  );
}

export function App() {
  const { t } = useTranslation();
  // Keeps react-aria's own built-in strings (a popover's hidden "Dismiss" button, say) in the
  // app's language rather than the browser's.
  const language = useLanguage();
  return (
    <I18nProvider locale={language}>
      <SessionProvider>
        <AppBackground />
        <a href="#main-content" className="skip-link">
          {t("app.skipToContent")}
        </a>
        <AppShell />
        {/* Outside AppShell: a waiting build should be offered on the nickname gate too. */}
        <UpdatePrompt />
      </SessionProvider>
    </I18nProvider>
  );
}
