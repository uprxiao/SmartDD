// Public Apache-2.0 Pierre rules, independently adapted using observed color facts.
// All 245 retained scope rules/font styles/order match the reviewed Codex resources.
// No private implementation or grammar is distributed. See licenses/M9/code-highlighting.
import pierreLight from '@pierre/theme/pierre-light';
import pierreDark from '@pierre/theme/pierre-dark';
const palettes = {
  dark: { '#737373':'#999999', '#5ecc71':'#85df7b', '#68cdf2':'#6DCBF4', '#ffd452':'#FA994C', '#ffab16':'#FA994C', '#ff678d':'#F67576', '#ffa359':'#FA994C', '#a3a3a3':'#999999', '#9d6afb':'#B06DFF', '#d568ea':'#B06DFF', '#636363':'#999999', '#08c0ef':'#6DCBF4', '#ff855e':'#F67576', '#fafafa':'#ffffff', '#60d199':'#6DCBF4', '#64d1db':'#3D8DFF', '#61d5c0':'#6DCBF4' },
  light: { '#737373':'#666666', '#199f43':'#008809', '#1ca1c7':'#0071EA', '#d5a910':'#BD5800', '#d5901c':'#BD5800', '#d32a61':'#D53538', '#d47628':'#BD5800', '#636363':'#666666', '#693acf':'#751ED9', '#a631be':'#751ED9', '#08c0ef':'#0071EA', '#d5512f':'#D53538', '#0a0a0a':'#ffffff', '#18a46c':'#0071EA', '#17a5af':'#001BCB', '#16a994':'#0071EA' },
};
const extraDecoratorRules = new Set(['entity.name.function.decorator', 'punctuation.definition.decorator']);
function adapt(original, mode) {
  const foreground = mode === 'dark' ? '#fcfcfc' : '#0d0d0d';
  const tokenColors = original.tokenColors.filter(rule => !extraDecoratorRules.has(rule.scope) && !(Array.isArray(rule.scope) && rule.scope.length === 2 && rule.scope[0] === 'meta.decorator' && rule.scope[1] === 'meta.decorator punctuation.decorator')).map(rule => {
    const settings = { ...rule.settings };
    if (settings.foreground) {
      const color = palettes[mode][settings.foreground];
      if (!color) throw new Error(`Unmapped public theme color: ${settings.foreground}`);
      settings.foreground = ['invalid.illegal.non-null-typehinted.php', 'token.error-token'].includes(rule.scope) ? '#f44747' : color;
    }
    return { ...rule, settings };
  });
  return Object.freeze({ name: `willyou-code-${mode}`, type: mode, colors: { 'editor.foreground': foreground, 'editor.background': mode === 'dark' ? '#111111' : '#ffffff' }, tokenColors });
}
export const CODE_THEMES = Object.freeze({ light: adapt(pierreLight, 'light'), dark: adapt(pierreDark, 'dark') });
