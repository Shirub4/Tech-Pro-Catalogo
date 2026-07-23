# Tech Pro Catálogo Online

Catálogo/menu online simples para:

- criar grupos e separar itens por tipo;
- cadastrar itens com imagem, descrição, informações e preço opcional;
- compartilhar o catálogo por link;
- permitir que o cliente escolha quantidades;
- registrar a seleção no painel administrativo;
- gerar uma resposta em PDF;
- compartilhar o PDF pelo WhatsApp no celular;
- no computador, baixar o PDF e abrir seu WhatsApp com a mensagem pronta.

## Estrutura

- `index.html`: catálogo público.
- `admin.html`: painel administrativo.
- `SUPABASE_SETUP.sql`: cria banco, permissões e armazenamento.
- `js/config.js`: recebe a URL e a chave pública do Supabase.
- `INICIAR_LOCALMENTE.bat`: abre um servidor local no Windows.

## 1. Criar o Supabase gratuito

1. Entre em `supabase.com` e crie uma conta.
2. Crie um novo projeto.
3. No menu lateral, abra **SQL Editor**.
4. Clique em **New query**.
5. Copie todo o conteúdo de `SUPABASE_SETUP.sql`, cole e execute em **Run**.

## 2. Criar o usuário administrador

1. No Supabase, abra **Authentication > Users**.
2. Clique em **Add user > Create new user**.
3. Informe seu e-mail e uma senha forte.
4. Marque a opção para o e-mail já ser considerado confirmado, se ela aparecer.

Não existe cadastro público de administrador dentro do site. Isso evita que outra pessoa crie acesso ao seu painel.

## 3. Ligar o site ao Supabase

1. No Supabase, abra **Project Settings > API Keys** ou clique em **Connect**.
2. Use a URL-base do projeto no formato `https://SEU-PROJETO.supabase.co`.
   - Não use o endpoint terminado em `/rest/v1/`.
3. Copie a chave pública **Publishable key** (`sb_publishable_...`) ou a chave **anon** legada.
4. Abra `js/config.js`.
5. Substitua os valores, mantendo obrigatoriamente as aspas:

```js
export const SUPABASE_URL = "COLE_AQUI_SUA_SUPABASE_URL";
export const SUPABASE_ANON_KEY = "COLE_AQUI_SUA_SUPABASE_ANON_KEY";
```

A chave pública pode ficar no site porque o acesso é controlado pelas políticas RLS. Nunca use `sb_secret_...` nem `service_role` no navegador.

## 4. Testar no computador

Dê dois cliques em `INICIAR_LOCALMENTE.bat`.

O catálogo abrirá em:

- `http://localhost:5500`
- painel: `http://localhost:5500/admin.html`

Também é possível abrir a pasta no VS Code e usar a extensão **Live Server**.

## 5. Colocar online gratuitamente no Cloudflare Pages

1. Crie uma conta em `cloudflare.com`.
2. Abra **Workers & Pages**.
3. Clique em **Create application**.
4. Escolha **Pages > Drag and drop your files**.
5. Digite um nome, por exemplo `tech-pro-catalogo`.
6. Arraste a pasta inteira do projeto ou o arquivo ZIP.
7. Clique em **Deploy site**.

O endereço ficará parecido com:

`https://tech-pro-catalogo.pages.dev`

O painel ficará em:

`https://tech-pro-catalogo.pages.dev/admin.html`

## 6. Uso diário

1. Entre em `admin.html`.
2. Cadastre primeiro os grupos.
3. Cadastre os itens, imagens e informações.
4. Em **Configurações**, confira o WhatsApp `5522999167083`.
5. Envie o link principal do catálogo ao cliente.
6. As escolhas aparecerão em **Seleções recebidas**.

## Como funciona o WhatsApp

No Android/iPhone, o botão tenta abrir o compartilhamento do sistema já com o PDF. O cliente escolhe o WhatsApp e a conversa da Tech Pro.

Em navegadores que não permitem compartilhar arquivos, o sistema:

1. baixa o PDF;
2. abre diretamente a conversa do WhatsApp da Tech Pro;
3. coloca a seleção no texto;
4. pede ao cliente para anexar o PDF baixado.

Navegadores não permitem anexar e enviar automaticamente um arquivo para uma conversa específica. Para envio totalmente automático sem nenhum toque do cliente, seria necessário configurar a WhatsApp Business Cloud API e um servidor com credenciais privadas.

## Limites gratuitos importantes

O plano gratuito do Supabase inclui espaço suficiente para um catálogo pequeno, mas projetos gratuitos podem ser pausados depois de uma semana sem atividade. Ao voltar a usar, entre no painel do Supabase para reativar o projeto, se necessário.

## Segurança

- Somente usuários autenticados podem cadastrar, editar e excluir grupos, itens e imagens.
- Visitantes podem apenas visualizar itens ativos e enviar uma seleção.
- As seleções recebidas só podem ser lidas pelo administrador autenticado.
- Nunca coloque a chave `service_role` em `config.js`.

## Atualização: galeria, detalhes e visibilidade

A versão atual permite escolher se Valor e GB aparecem em cada item, cadastrar até 12 imagens, navegar pelas imagens diretamente nos cartões e abrir uma visualização detalhada do produto. Não é necessário executar SQL adicional.


## Atualização: organização rápida no painel

- Itens cadastrados separados por grupo.
- Alteração de grupo diretamente na lista, sem abrir a edição.
- Valor e GB podem ser exibidos ou ocultados diretamente na lista.
- A descrição principal aparece somente na janela de detalhes do catálogo.
- As informações extras continuam visíveis no cartão.
- Não requer alterações no Supabase.


## Aviso de idioma no cartão

No cadastro/edição do item, marque **Jogo dublado ou legendado em português** para exibir um aviso verde no cartão. A descrição e as informações extras aparecem somente ao abrir os detalhes. Itens antigos que já usavam essa frase em Informações extras são reconhecidos automaticamente.

## Imagem dos itens no PDF

A imagem que estiver visível no cartão do item no momento da finalização é registrada na seleção e adicionada ao PDF em proporção 7:10. As seleções novas também preservam a URL da capa para que o PDF baixado posteriormente no painel administrativo continue exibindo a imagem.

## PDF separado por tipo

O PDF de finalização organiza os itens em seções conforme os grupos cadastrados. Cada seção exibe o nome do grupo, a quantidade de itens selecionados e sua própria tabela com imagens, quantidades, valores e GB.
