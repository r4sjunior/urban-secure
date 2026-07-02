/**
 * components/AudiusPlayer.jsx
 * Player nativo do Audius (embed oficial), discreto, tocando em loop de fundo.
 * O iframe é de outra origem — não dá para controlar volume/play via JS a partir
 * daqui, então "mutar" monta/desmonta o embed junto com o botão de som do app.
 */
export default function AudiusPlayer({ muted }) {
  if (muted) return null;
  return (
    <div className="audius-embed">
      <iframe
        src="https://audius.co/embed/track/MWZK/mpc-fulani-riddim?flavor=tiny"
        width="100%"
        height="24"
        allowTransparency="true"
        allow="autoplay; encrypted-media"
        style={{ border: 'none' }}
        title="Audius player"
        loading="lazy"
      />
    </div>
  );
}
