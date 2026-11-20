// Phone notifications (web push). iPhones only allow this from the app added to the Home Screen.
import { supabase } from "./supabase";

export type PushState = "unsupported" | "needs-install" | "no-key" | "blocked" | "off" | "on";

const KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

const isIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export async function pushState(): Promise<PushState> {
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!capable) return isIphone() && !isInstalled() ? "needs-install" : "unsupported";
  if (!KEY) return "no-key";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? "on" : "off";
}

/** A short name for this device, so old installs can be told apart later. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const kind = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Browser";
  return `${kind}${isInstalled() ? " app" : ""}`;
}

export interface Device { endpoint: string; label: string | null; created_at: string; here: boolean }

/** The phones this person has turned notifications on for, newest first. */
export async function listDevices(): Promise<Device[]> {
  const mine = "serviceWorker" in navigator ? await (await navigator.serviceWorker.ready).pushManager.getSubscription() : null;
  const { data, error } = await supabase.from("push_subscriptions").select("endpoint, label, created_at").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((d) => ({ endpoint: d.endpoint as string, label: (d.label as string | null) ?? null, created_at: d.created_at as string, here: mine?.endpoint === d.endpoint }));
}

export async function removeDevice(endpoint: string): Promise<void> {
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw error;
}

const toBytes = (b64: string) => {
  const raw = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Must be called from a tap. Asks permission, subscribes this phone, and saves it for the server. */
export async function enablePush(): Promise<PushState> {
  if (!KEY) return "no-key";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const reg = await navigator.serviceWorker.ready;
  let sub: PushSubscription;
  try {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(KEY) });
  } catch (e) {
    throw new Error(`this phone couldn't subscribe (${(e as Error).name}: ${(e as Error).message})`);
  }
  const json = sub.toJSON();
  // ignoreDuplicates: a phone that is already saved is fine. (The browser may insert and delete, not update.)
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, label: deviceLabel() }, { onConflict: "endpoint", ignoreDuplicates: true });
  if (error) {
    await sub.unsubscribe(); // never leave a phone subscribed that the server doesn't know about
    throw new Error(`saving failed (${error.code ?? "error"}: ${error.message})`);
  }
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    if (error) throw error;
    await sub.unsubscribe();
  }
  return "off";
}
