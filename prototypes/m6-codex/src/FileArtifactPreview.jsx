import { FileOfficePreview } from './FileOfficePreview';
import { FilePdfPreview } from './FilePdfPreview';
import { FileNotebookPreview } from './FileNotebookPreview';
import { FileCsvPreview } from './FileCsvPreview';

// Synthetic route adapters. No document codec, kernel, or AI operation executes.
export function FileArtifactPreview(props) {
  if (['csv', 'tsv'].includes(props.kind)) return <FileCsvPreview {...props} />;
  if (['pdf', 'pdf-review', 'tex'].includes(props.kind)) return <FilePdfPreview {...props} />;
  if (props.kind === 'ipynb') return <FileNotebookPreview {...props} />;
  return <FileOfficePreview {...props} />;
}
