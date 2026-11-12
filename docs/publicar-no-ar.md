# Colocar o ARGOS no ar com domínio próprio

Guia passo a passo para publicar o ARGOS num servidor próprio (VPS), com endereço `https://seu-dominio`,
certificado HTTPS automático, e-mail de confirmação funcionando e cópia de segurança diária.

O projeto já traz tudo o que roda no servidor:

| Arquivo | Para que serve |
|---|---|
| `Dockerfile` | Gera uma imagem com a API e a web juntas (a API serve o site; um serviço só, no mesmo domínio). |
| `deploy/docker-compose.yml` | Sobe três contêineres: **caddy** (HTTPS), **argos** (site + API) e **backup** (cópia diária). |
| `deploy/Caddyfile` | HTTPS automático (Let's Encrypt), compressão e `www` → domínio principal. |
| `deploy/instalar.sh` | Instala o Docker, pergunta os dados, gera os segredos, sobe tudo e mostra a senha do administrador. |
| `deploy/atualizar.sh` | Faz backup, baixa o código novo, reconstrói e confere se voltou. |
| `deploy/.env.example` | Modelo da configuração, para quem preferir preencher à mão. |

O que o servidor cuida sozinho: títulos e prévias de link (WhatsApp, redes sociais) de cada caso, `robots.txt`,
`sitemap.xml`, cabeçalhos de segurança (CSP, HSTS…), cache de longo prazo e compressão dos arquivos da web,
migrações do banco com cópia prévia, expurgo de dados vencidos e backup verificado a cada 24 h.

---

## 1. O que você precisa providenciar

Estas três coisas dependem de conta e pagamento em seu nome; ninguém consegue fazer por você.

1. **Um domínio.** Para `.com.br`: [registro.br](https://registro.br) (pede CPF ou CNPJ; anuidade na faixa de
   R$ 40). Para `.com`: qualquer registrador (Cloudflare, Namecheap, Porkbun…). Confira o preço atual.
2. **Um servidor Linux (VPS)** com **Ubuntu 24.04** (ou 22.04), IP público, **2 GB de RAM** de preferência
   (1 GB funciona: o instalador cria memória extra em disco) e uns 20 GB de disco. Exemplos de provedores:
   Hetzner, DigitalOcean, Contabo, Magalu Cloud, Oracle Cloud (tem plano gratuito, mas pede cartão e às vezes
   falta vaga). Planos de entrada costumam custar alguns dólares por mês; compare antes.
3. **Uma conta de e-mail para envio.** A conta Gmail do ARGOS com **senha de app** já serve para começar
   (limite diário de algumas centenas de mensagens; podem cair no spam). Com domínio próprio, o ideal é um serviço de
   envio (Brevo, Resend) com SPF e DKIM configurados no DNS — veja a seção 6.

> O ARGOS usa SQLite e fotos em disco: precisa de **um servidor com disco persistente**. Hospedagens "grátis"
> que apagam o disco a cada reinício (planos free de Render, Vercel, Netlify…) **perdem o banco**.

## 2. Apontar o domínio para o servidor (DNS)

No painel do domínio (no registro.br: *Domínio › DNS › Editar zona*), crie dois registros do tipo **A** com o
IP do servidor:

| Tipo | Nome | Valor |
|---|---|---|
| A | (vazio ou `@`) | IP do servidor |
| A | `www` | IP do servidor |

Se o servidor tiver IPv6, crie também os registros **AAAA**. Se usar Cloudflare, deixe a nuvem **cinza**
("DNS only"); com o proxy laranja ligado, o IP real das pessoas não chega à API.

Confira, do seu computador (pode levar de minutos a algumas horas): `nslookup seu-dominio.com.br` deve mostrar o IP
do servidor.

## 3. Levar o código para o servidor

O servidor baixa o código do GitHub. **Antes, faça commit e push** destas alterações para a branch que será
publicada. Depois, no servidor (acesso por SSH: `ssh root@IP-DO-SERVIDOR`):

```bash
apt-get update && apt-get install -y git
git clone https://github.com/Guilherme1ds/ARGOS.git /opt/argos
cd /opt/argos
git checkout <branch-publicada>
```

Repositório privado: use um *token de acesso* do GitHub (Settings › Developer settings › Personal access tokens,
só leitura) quando o `git clone` pedir senha. Nunca coloque segredos no repositório.

## 4. Instalar

Com o DNS já apontando para o servidor:

```bash
cd /opt/argos
sudo bash deploy/instalar.sh
```

O instalador pergunta: domínio, seu e-mail (administrador), servidor/porta/usuário/senha SMTP (a senha não
aparece na tela) e, opcionalmente, um e-mail público de atendimento. Ele:

- instala Docker e Docker Compose, cria memória extra se o servidor tiver menos de 2 GB;
- gera `deploy/.env` (só o root lê) com segredo de sessão e senha inicial fortes;
- constrói a imagem (5 a 10 minutos na primeira vez), sobe os contêineres e espera a API ficar pronta;
- mostra o endereço e a **senha do administrador uma única vez** e depois a apaga do arquivo.

No primeiro acesso a `https://seu-dominio`, o Caddy emite o certificado (até 1 minuto). Se o provedor tiver
firewall próprio no painel, libere as portas **80** e **443** (TCP e UDP).

## 5. Primeiro acesso (10 minutos)

1. Abra `https://seu-dominio/health/ready`: deve mostrar `"status":"ready"`.
2. Entre com o e-mail e a senha mostrados pelo instalador; troque a senha em **Configurações › Segurança**.
3. **Administração › Testar e-mail**: a mensagem precisa chegar na sua caixa.
4. Crie uma conta comum com outro e-mail: o link de confirmação deve chegar e abrir no celular.
5. Publique um caso com foto e compartilhe o link no WhatsApp: a prévia mostra título e foto.
6. Siga o checklist de homologação em [`docs/operacao.md`](operacao.md), seção 7.

## 6. E-mail sem cair no spam (recomendado com domínio próprio)

1. Crie conta num serviço de envio (Brevo tem plano gratuito de 300 e-mails/dia; Resend também tem).
2. Cadastre o domínio no serviço e copie para o DNS os registros que ele mostrar: **SPF** (TXT),
   **DKIM** (TXT ou CNAME) e, de preferência, **DMARC** (TXT `_dmarc` com `v=DMARC1; p=none; rua=mailto:...`).
3. No servidor, edite `deploy/.env` (`sudo nano /opt/argos/deploy/.env`):
   `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `MAIL_FROM='ARGOS <nao-responda@seu-dominio>'`.
4. Aplique: `cd /opt/argos/deploy && sudo docker compose up -d` e repita o **Testar e-mail**.

## 7. Cópias de segurança

- O contêiner `backup` grava uma cópia **verificada** (banco + fotos + manifesto com hash) a cada 24 h em
  `/opt/argos/deploy/backups/` e mantém as 14 mais recentes (`BACKUP_KEEP`).
- **Copie para fora do servidor** pelo menos uma vez por semana. Do seu computador:
  `scp -r root@IP-DO-SERVIDOR:/opt/argos/deploy/backups ./argos-backups` — ou use `rclone` para um armazenamento
  na nuvem. Os backups têm dados pessoais: guarde criptografado e com acesso restrito.
- Teste a restauração uma vez por mês (seção 9).

## 8. Atualizar para uma versão nova

Depois de enviar as mudanças para o GitHub:

```bash
cd /opt/argos
sudo bash deploy/atualizar.sh
```

O script faz um backup, roda `git pull`, reconstrói a imagem, reinicia (as migrações do banco rodam sozinhas, com
cópia prévia) e confere a saúde da API.

## 9. Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Navegador diz que o certificado é inválido | O DNS ainda não aponta para o servidor ou as portas 80/443 estão fechadas. Veja `cd deploy && sudo docker compose logs caddy`. |
| Página "502" ou fora do ar | `sudo docker compose ps` e `sudo docker compose logs --tail 100 argos`. "Configuração inválida" cita a variável errada do `deploy/.env` (nunca o valor). |
| E-mails não chegam | Administração › Testar e-mail mostra o erro. Gmail exige senha de app; confira a pasta de spam; com domínio próprio, configure SPF/DKIM (seção 6). |
| Disco cheio | `df -h`; reduza `BACKUP_KEEP`; logs já são limitados (5 × 10 MB por contêiner). |
| Voltar um backup | Veja abaixo. |

Restaurar um backup (a API fica parada durante a restauração; o estado atual é guardado como
`*.before-restore-<data>`, dá para desfazer):

```bash
cd /opt/argos/deploy
ls backups/                                   # escolha a pasta argos-backup-<data>
sudo docker compose stop argos backup
sudo docker compose run --rm --no-deps -v "$PWD/backups:/backups" argos \
  node dist/ops/backup-cli.js restore /backups/argos-backup-<data> --force
sudo docker compose up -d
```

## 10. Alternativa sem administrar servidor (não testada aqui)

Plataformas como Railway, Render (plano pago) ou Fly.io constroem o `Dockerfile` direto do GitHub. Requisitos:
um **volume persistente montado em `/data`**, as variáveis do `deploy/.env.example` mais `FRONTEND_URL`,
`API_PUBLIC_URL` e `CORS_ORIGINS` com `https://seu-dominio`, e o domínio próprio cadastrado no painel da plataforma
(ela emite o certificado). `TRUST_PROXY` depende de quantos proxies a plataforma põe na frente: confira nos logs
se aparece o IP real de quem acessa. Nesse caso o Caddy e o contêiner de backup não são usados: agende o backup
pela plataforma (`node dist/ops/backup-cli.js backup --out /data/backups/daily --keep 14`) e copie para fora.

## 11. App Android apontando para o domínio

O app não é publicado em loja por este guia. Para gerar um APK de teste que usa o servidor real:

```bash
cd apps/flutter
flutter build apk --release \
  --dart-define=ARGOS_API_URL=https://seu-dominio/api/v1 \
  --dart-define=ARGOS_API_PUBLIC_URL=https://seu-dominio \
  --dart-define=ARGOS_WEB_URL=https://seu-dominio
```
