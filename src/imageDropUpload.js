function imageInput(target) {
  return [...target.querySelectorAll('input[type="file"]')].find(input => /image\//.test(input.accept));
}
function accepts(file, accept) {
  return accept.split(',').some(value => {
    const rule=value.trim().toLowerCase();
    return rule === 'image/*' ? file.type.startsWith('image/') : rule.startsWith('.') ? file.name.toLowerCase().endsWith(rule) : file.type === rule;
  });
}
export const imageDropProps = {
  onDragOver(event) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    const input=imageInput(event.currentTarget);
    if (!input) return;
    event.preventDefault();event.stopPropagation();
    event.dataTransfer.dropEffect=input.disabled ? 'none' : 'copy';
  },
  onDrop(event) {
    const input=imageInput(event.currentTarget);
    if (!input) return;
    event.preventDefault();event.stopPropagation();
    if (input.disabled) return;
    const files=Array.from(event.dataTransfer.files).filter(file=>accepts(file,input.accept));
    if (!files.length) return;
    const transfer=new DataTransfer();
    for (const file of input.multiple ? files : files.slice(0,1)) transfer.items.add(file);
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  },
};
