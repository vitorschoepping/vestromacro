/* Pages Function da raiz do dominio: enquanto a raiz nao tem pagina propria, leva ao Vestro Macro no idioma
   do pais de quem acessa (a mesma regra das paginas sem idioma, em vestromacro/[[pagina]].js).
   O .exe 2.2.1 mostra "vestroautomation.com" no aviso de atualizacao: a raiz precisa levar ao Vestro Macro. */
export { onRequest } from "./vestromacro/[[pagina]].js";
