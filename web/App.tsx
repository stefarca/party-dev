import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { Button, Form, I18nProvider, Input, Label, Popover, TextField } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { NICKNAME_MAX_LENGTH } from "../shared/nickname";
import { AppBackground } from "./components/AppBackground";
import { BrandName, Buddy } from "./components/Brand";
import { LanguagePicker } from "./components/LanguagePicker";
import { NotificationToggle } from "./components/NotificationToggle";
import { PlayerAvatar } from "./components/PlayerAvatar";
import { Spinner } from "./components/states";
import { ThemeToggle } from "./components/ThemeToggle";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { errorText } from "./errors";
import { useLanguage } from "./i18n";
import { DailyPage } from "./routes/DailyPage";
import { Dashboard } from "./routes/Dashboard";
import { MatchPage } from "./routes/MatchPage";
import { NicknameGate } from "./routes/NicknameGate";
import { navigate, useRoute } from "./router";
import { SessionProvider, useSession } from "./session";

// One setting in the profile popup: its name, and the control beside it. The
// control carries the same name as its accessible label.
function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-bold text-[var(--text-muted)]">{label}</span>
      {children}
    </div>
  );
}

// The player's own popup, behind their avatar. The nickname is the account,
// so it covers both things a player can do with it: move their own player
// onto a different nickname (keeping every match), or end the session so
// someone else can sign in on this device. Renaming into a nickname somebody
// else holds is refused by the server — signing out is the way to switch
// into it deliberately. The theme and the language live here too, as the
// player's settings, which keeps the header down to what fits on a phone.
//
// Nothing takes focus inside the popup when it opens (the dialog itself
// does): focusing the nickname field would raise a phone's keyboard over the
// settings every time someone came to change one.
function ProfileControl() {
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
        aria-label={t("profile.trigger", { nickname })}
        className="max-w-48 min-w-0 shrink gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--surface-2)] pr-2.5 pl-1 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] hover:scale-105 sm:max-w-none"
      >
        <PlayerAvatar id={player.playerId} nickname={nickname} size="sm" />
        <span className="truncate text-sm font-bold">{nickname}</span>
        {/* Says there is more behind the button than a name to edit. */}
        <svg
          viewBox="0 0 24 24"
          className="size-3.5 flex-none text-[var(--text-muted)]"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </Button>
      <Popover.Content placement="bottom end">
        <Popover.Dialog aria-label={t("profile.dialog")} className="flex w-64 flex-col gap-4 p-4">
          <Form onSubmit={handleRename} className="flex flex-col gap-3">
            <TextField value={value} onChange={setValue} maxLength={NICKNAME_MAX_LENGTH}>
              <Label className="text-xs font-bold text-[var(--text-muted)]">
                {t("rename.label")}
              </Label>
              <Input />
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
          </Form>
          <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-4">
            <SettingRow label={t("theme.label")}>
              <ThemeToggle />
            </SettingRow>
            <SettingRow label={t("language.label")}>
              <LanguagePicker />
            </SettingRow>
          </div>
          <div className="border-t border-[var(--border-subtle)] pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onPress={handleSignOut}
              // Pulled left by its own padding, so its label lines up with the ones above it.
              className="-ml-3 text-[var(--text-muted)]"
            >
              {t("rename.signOut")}
            </Button>
          </div>
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
          className="group inline-flex items-center gap-2 text-lg text-[var(--text-primary)] no-underline"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <Buddy
            animated
            className="size-7 text-accent transition-transform duration-[var(--dur-base)] ease-[var(--ease-bounce)] group-hover:rotate-12 group-hover:scale-110"
          />
          <BrandName />
        </a>
        {/* `min-w-0` lets the nickname button truncate instead of pushing the row past a
            phone's width. The theme and the language are in the profile popup. */}
        <div className="flex min-w-0 items-center gap-2">
          <ProfileControl />
          <NotificationToggle />
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
  if (route.name === "daily") return <DailyPage gameId={route.gameId} />;
  return (
    <main id="main-content" className="app-container">
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <Buddy animated className="size-14 text-accent opacity-60" />
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
        <Buddy animated className="size-14 text-accent" />
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
