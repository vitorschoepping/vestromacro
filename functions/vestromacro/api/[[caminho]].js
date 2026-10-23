/*
Pages Function: passa /vestromacro/api/* (a API da area do cliente) para o Worker vestro-licencas.

A rota do Worker (www.vestroautomation.com/vestromacro/api/*) nao roda no dominio proprio do Pages:
quem respondia era o Pages, com a pagina 404. Por isso o Pages entrega o pedido ao Worker pelo
Service Binding CONTA (Pages -> vestromacro -> Settings -> Bindings -> Service binding, nome CONTA,
servico vestro-licencas). O pedido vai inteiro, com o endereco e o CF-Connecting-IP de quem pediu.
O pais vai tambem no cabecalho cf-ipcountry, caso o request.cf nao chegue ao Worker pelo binding.
*/

export async function onRequest({ request, env }) {
  if (!env.CONTA) {
    return new Response(JSON.stringify({ ok: false, erro: "indisponivel", mensagem: "Algo deu errado. Tente de novo daqui a pouco." }),
      { status: 503, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const pedido = new Request(request);
  const pais = request.cf && request.cf.country;
  if (pais) pedido.headers.set("cf-ipcountry", pais);
  return env.CONTA.fetch(pedido);
}
