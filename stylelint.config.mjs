// stylelint holder fargeverdiene i src/theme.css, der designsystemets farger defineres.
// Andre CSS-filer bruker variablene derfra. Bare fargereglene er slått på; stil eies av Prettier.
// CSS-funksjonsnavn skiller ikke mellom store og små bokstaver, så mønstrene gjør det heller ikke.
const colorFunctions = [/^rgba?$/i, /^hsla?$/i, /^hwb$/i, /^(ok)?lab$/i, /^(ok)?lch$/i, /^color$/i];

export default {
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': colorFunctions,
  },
  overrides: [
    {
      files: ['src/theme.css'],
      rules: {
        'color-no-hex': null,
        'color-named': null,
        'function-disallowed-list': null,
      },
    },
  ],
};
