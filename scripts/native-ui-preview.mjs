import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
/** Exercise the actual Harness Modal, Button, focus trap and IME guard in the browser fixture. */
export async function nativeUiPreview(source) {
  if (!source) throw new Error('Set DSH_SOURCE_DIR to render the native Harness UI primitives.');
  const root = join(source, 'packages/client/ui-primitives/src');
  const compile = async file => ts.transpileModule(await readFile(join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
  }).outputText.replace(/^import .*?;\r?\n/gm, '').replace(/^export /gm, '').replace(/^\{\};\r?\n/gm, '');
  const css = async (file, prefix) => (await readFile(join(root, file), 'utf8')).replace(/\.([A-Za-z_][\w-]*)/g, (_, key) => `.${prefix}-${key}`);
  const helpers = (await Promise.all(['keyboard-composition.ts', 'focus.ts', 'useModalLayer.ts'].map(compile))).join('\n');
  const [modal, button, modalCss, buttonCss, base, platform, focus] = await Promise.all([
    compile('Modal.tsx'), compile('Button.tsx'), css('Modal.module.css', 'native-modal'), css('Button.module.css', 'native-button'),
    ...['base.css', 'design-platform.css', 'focus.css'].map(name => readFile(join(source, 'packages/client/ui-theme/src/styles', name), 'utf8')),
  ]);
  return {
    js: `window.hooksUi=(()=>{const {useRef,useLayoutEffect,forwardRef}=React;const {createPortal}=ReactDOM;const clsx=(...items)=>items.filter(Boolean).join(' ');const IconCloseOutlineRegular=()=>React.createElement('span',{'aria-hidden':true},'×');${helpers}
      const NativeModal=(()=>{const css=new Proxy({},{get:(_,key)=>'native-modal-'+key});${modal};return Modal})();
      const NativeButton=(()=>{const css=new Proxy({},{get:(_,key)=>'native-button-'+key});${button};return Button})();
      return{Modal:NativeModal,Button:NativeButton};})();`,
    css: [base, platform, focus, modalCss, buttonCss].join('\n'),
  };
}
