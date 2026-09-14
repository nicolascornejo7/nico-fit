export function clearNode(node){while(node.firstChild)node.removeChild(node.firstChild);return node;}
export function appendTextElement(parent,tag,text,className=''){
  const element=parent.ownerDocument.createElement(tag);if(className)element.className=className;element.textContent=String(text??'');parent.appendChild(element);return element;
}
