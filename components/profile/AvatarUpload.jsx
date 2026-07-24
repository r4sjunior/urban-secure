/**
 * components/profile/AvatarUpload.jsx
 * Escolhe, recorta e sobe a foto de perfil pro IPFS.
 *
 * Sobe a imagem NA HORA da escolha, não no submit do formulário. O upload
 * leva alguns segundos e o usuário costuma escolher a foto e continuar
 * preenchendo a bio — fazer o upload aqui aproveita esse tempo. No submit, o
 * `avatarUrl` já está pronto.
 *
 * Diferente do registro de arte, aqui a galeria é permitida de propósito: a
 * regra de "só câmera" existe pra garantir que a ARTE é real e está no local
 * declarado; foto de perfil não tem essa exigência.
 */

import { useState, useRef, useEffect } from 'react';
import { cropSquareAvatar } from '../../lib/social/avatar';
import { uploadFile } from '../../lib/mint';
import Avatar from './Avatar';

export default function AvatarUpload({ wallet, handle, avatarUrl, onChange, disabled }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState('');
  const inputRef = useRef(null);

  // O preview é um object URL; sem revogar, cada troca de foto vaza um blob
  // que só sai da memória quando a aba fecha.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function handlePick(e) {
    const file = e.target.files?.[0];
    // Limpa o input pra que escolher o MESMO arquivo de novo (depois de um
    // erro) volte a disparar o change — o browser não emite o evento quando
    // o valor não muda.
    e.target.value = '';
    if (!file) return;

    setError(null);
    setUploading(true);

    let localPreview = '';
    try {
      const cropped = await cropSquareAvatar(file);

      // Preview imediato do arquivo já recortado — o usuário vê o
      // enquadramento final enquanto o upload acontece.
      localPreview = URL.createObjectURL(cropped);
      setPreview(prev => { if (prev) URL.revokeObjectURL(prev); return localPreview; });

      const url = await uploadFile(cropped);
      onChange(url);
    } catch (err) {
      console.error('[AvatarUpload]', err);
      if (localPreview) {
        URL.revokeObjectURL(localPreview);
        setPreview('');
      }
      setError('Não foi possível enviar a foto. Tente outra imagem.');
    } finally {
      setUploading(false);
    }
  }

  function handleRemove() {
    setPreview(prev => { if (prev) URL.revokeObjectURL(prev); return ''; });
    setError(null);
    onChange('');
  }

  const shown = preview || avatarUrl;

  return (
    <div className="avatar-upload">
      <button
        type="button"
        className="avatar-upload-target"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        aria-label="Trocar foto de perfil"
      >
        {shown
          ? <img className="avatar avatar-ring" style={{ width: 88, height: 88 }} src={shown} alt="" />
          : <Avatar profile={{ handle, avatarUrl: '' }} wallet={wallet} size={88} ring />}

        <span className="avatar-upload-badge">{uploading ? '⏳' : '📷'}</span>
      </button>

      <div className="avatar-upload-side">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
        >
          {uploading ? 'Enviando…' : shown ? 'Trocar foto' : 'Escolher foto'}
        </button>

        {shown && !uploading && (
          <button type="button" className="btn-ghost btn-ghost-danger" onClick={handleRemove} disabled={disabled}>
            Remover
          </button>
        )}

        {error && <span className="avatar-upload-err">{error}</span>}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handlePick}
        disabled={disabled || uploading}
        hidden
      />
    </div>
  );
}
