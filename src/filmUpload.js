const readFile=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
export async function filmUpload(request,projectId,file,kind){return request('/'+projectId+'/upload',{kind,name:file.name,data:await readFile(file)});}
