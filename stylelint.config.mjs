// stylelint holder fargeverdiene i src/theme.css, der designsystemets farger defineres.
// Andre CSS-filer bruker variablene derfra. Bare fargereglene er slått på; stil eies av Prettier.
const colorFunctions = ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color'];

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
