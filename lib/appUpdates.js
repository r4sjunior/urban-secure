/**
 * lib/appUpdates.js
 * Novidades do app — alimenta o ticker inferior e a tela de tutorial.
 *
 * Fica num arquivo de dados, e não espalhado na UI, porque estas duas telas
 * mostram a MESMA lista com formatos diferentes. Duas listas separadas
 * divergiriam na primeira atualização que alguém esquecesse de copiar.
 *
 * Ordem: mais recente primeiro.
 */

export const APP_VERSION = 'alpha 0.3';

/**
 * @typedef {object} Update
 * @property {string} id     estável — usado como key e para marcar como lido
 * @property {string} tag    categoria curta exibida no chip
 * @property {string} texto  uma linha, no presente, focada no que a pessoa ganha
 */
export const UPDATES = [
  { id: 'tema-claro',   tag: 'Visual',    texto: 'Tema claro e escuro, com troca no topo da tela' },
  { id: 'seguir',       tag: 'Social',    texto: 'Agora dá para seguir outros artistas' },
  { id: 'sem-mercado',  tag: 'Foco',      texto: 'Compra e venda saíram — o app é sobre registrar e colecionar' },
  { id: 'figurinhas',   tag: 'Novo',      texto: 'Álbum de figurinhas com abertura de pacote em 3D' },
  { id: 'ranking',      tag: 'Novo',      texto: 'Ranking semanal premia os três primeiros em SOL' },
  { id: 'camera',       tag: 'Segurança', texto: 'Registro só pela câmera, na hora, no local da obra' },
  { id: 'claim',        tag: 'Novo',      texto: 'Claim diário e streak de 7 dias com pacote de figurinha' },
  { id: 'core',         tag: 'Rede',      texto: 'Mint em Metaplex Core: registrar arte ficou 70% mais barato' },
];

/** Passos do tutorial. É a proposta do app contada na ordem em que a pessoa
 *  vai viver — encontrar, registrar, voltar, colecionar, competir. */
export const TUTORIAL = [
  {
    id: 'mapa',
    icone: 'MapPin',
    titulo: 'O mapa é o feed',
    texto: 'Cada pino é uma obra registrada por alguém, no lugar exato onde ela está. Toque para ver, curtir e traçar rota até lá.',
  },
  {
    id: 'registrar',
    icone: 'Camera',
    titulo: 'Registre o que você vê',
    texto: 'Só vale foto ou vídeo feito na hora, pela câmera do app. É isso que garante que a arte é real e está onde diz estar — não dá para subir imagem da galeria.',
  },
  {
    id: 'claim',
    icone: 'Flame',
    titulo: 'Volte todo dia',
    texto: 'O projeto te dá SOL todo dia para cobrir o registro de 3 artes. Sete dias seguidos e o resgate dobra, além de liberar um pacote de figurinha.',
  },
  {
    id: 'album',
    icone: 'Layers',
    titulo: 'Monte seu álbum',
    texto: 'Cada figurinha estampa a obra de outro artista, com o nome dele junto. Cole as que faltam, troque as repetidas.',
  },
  {
    id: 'ranking',
    icone: 'Trophy',
    titulo: 'Dispute a semana',
    texto: 'Quem mais registrar artes na semana leva 0,05 SOL. Segundo e terceiro também são premiados, toda segunda-feira.',
  },
];
