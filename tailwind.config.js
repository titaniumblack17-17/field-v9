const teinte = (nom) => `rgb(var(--${nom}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Couleurs sémantiques adossées aux variables CSS de index.css :
        // le mode sombre s'applique là-bas, une seule fois.
        fond: teinte('fond'),
        carte: teinte('carte'),
        'carte-douce': teinte('carte-douce'),
        texte: teinte('texte'),
        'texte-doux': teinte('texte-doux'),
        'texte-faible': teinte('texte-faible'),
        'texte-fantome': teinte('texte-fantome'),
        separateur: teinte('separateur'),
        bordure: teinte('bordure'),
        accent: teinte('accent'),
        alerte: teinte('alerte'),
        erreur: teinte('erreur'),
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
}
