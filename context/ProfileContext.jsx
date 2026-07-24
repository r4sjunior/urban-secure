/**
 * context/ProfileContext.jsx
 * Perfil da carteira conectada: carrega ao conectar, salva com assinatura.
 *
 * Só cuida do perfil PRÓPRIO. Perfil de terceiro é lido pontualmente por
 * `useProfile(wallet)` (lib/hooks/useProfile.js) — colocar perfis alheios
 * neste contexto faria toda visita a um perfil re-renderizar o app inteiro.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { defaultProfile, normalizeProfile } from '../lib/social/profile';
import { buildProfileMessage, hashProfileContent } from '../lib/social/profileSignature';

const ProfileContext = createContext(null);

const EMPTY_STATS = {
  artsRegistered: 0,
  stickersCollected: 0,
  currentStreak: 0,
  longestStreak: 0,
  completedCycles: 0,
  weeklyRank: null,
  artsThisWeek: 0,
};

export function ProfileProvider({ children }) {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() || null;

  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  // Guarda de corrida: o usuário pode trocar de conta no Phantom enquanto um
  // fetch está no ar. Sem isto, a resposta lenta da carteira ANTIGA chegaria
  // depois e sobrescreveria o perfil da nova — o usuário veria o perfil
  // errado, com o próprio endereço no topo.
  const requestedFor = useRef(null);

  const load = useCallback(async (target) => {
    if (!target) {
      setProfile(null);
      setStats(EMPTY_STATS);
      return;
    }

    requestedFor.current = target;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/profile?wallet=${encodeURIComponent(target)}`);
      const json = await res.json();

      if (requestedFor.current !== target) return; // carteira mudou no meio

      if (!res.ok) throw new Error(json.error || 'Erro ao carregar perfil.');

      setProfile(json.profile || defaultProfile(target));
      setStats(json.stats || EMPTY_STATS);
    } catch (err) {
      if (requestedFor.current !== target) return;
      console.error('[ProfileContext] load:', err.message);
      // Falha de leitura não pode travar o app: cai pro perfil vazio, que é
      // exatamente o que uma carteira sem perfil teria. O usuário ainda
      // consegue preencher e salvar.
      setProfile(defaultProfile(target));
      setError('Não foi possível carregar seu perfil.');
    } finally {
      if (requestedFor.current === target) setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(address); }, [address, load]);

  /**
   * Salva o perfil. Assina o hash do conteúdo JÁ NORMALIZADO com as mesmas
   * funções que o servidor usa — se normalizássemos diferente, o hash não
   * bateria e o servidor recusaria uma assinatura legítima.
   *
   * @returns {{ ok: boolean, error?: string }}
   */
  const saveProfile = useCallback(async (input) => {
    if (!address) return { ok: false, error: 'Conecte sua carteira.' };
    if (!wallet.signMessage) {
      return { ok: false, error: 'Esta carteira não suporta assinatura de mensagem.' };
    }

    setIsSaving(true);
    setError(null);

    try {
      const normalized = normalizeProfile(input, address);
      const contentHash = hashProfileContent(normalized);
      const timestamp = Date.now();

      const message = buildProfileMessage({ wallet: address, contentHash, timestamp });
      const sigBytes = await wallet.signMessage(new TextEncoder().encode(message));
      const signature = Buffer.from(sigBytes).toString('base64');

      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...normalized, timestamp, signature }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao salvar.');

      setProfile(json.profile);
      return { ok: true };
    } catch (err) {
      const raw = err?.message || 'Erro ao salvar perfil.';
      const msg = /rejected|User rejected|cancel/i.test(raw)
        ? 'Assinatura cancelada.'
        : raw;
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setIsSaving(false);
    }
  }, [address, wallet]);

  const value = {
    address,
    profile,
    stats,
    isLoading,
    isSaving,
    error,
    saveProfile,
    refresh: () => load(address),
    /** Perfil "vazio" (nunca salvo) — usado pra sugerir o preenchimento. */
    hasProfile: !!profile?.updatedAt,
  };

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useMyProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useMyProfile deve ser usado dentro de <ProfileProvider>');
  return ctx;
}
