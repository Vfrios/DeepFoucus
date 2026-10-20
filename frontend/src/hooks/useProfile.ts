import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export interface Profile {
  email: string | null;
  name: string | null;
  picture: string | null;
}

const EMPTY: Profile = { email: null, name: null, picture: null };

/**
 * Busca /api/auth/me uma vez ao carregar (e ao voltar para a aba se ainda vazio).
 * Estado: { profile, loading, error }.
 */
export function useProfile() {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancel = false;

    const load = async () => {
      try {
        const data = await api<Profile>('/auth/me');
        if (cancel) return;
        setProfile(data || EMPTY);
        setError('');
      } catch (e: any) {
        if (cancel) return;
        setError(String(e?.message || 'erro'));
      } finally {
        if (!cancel) setLoading(false);
      }
    };

    load();

    // Se ainda não carregou o perfil e o usuário volta à aba (ex.: acabou de autorizar o Google),
    // tenta de novo.
    const onVis = () => {
      if (document.visibilityState === 'visible' && !profile.email) load();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancel = true;
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { profile, loading, error };
}
