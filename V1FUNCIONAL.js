// ============================================
// CONFIGURAÇÃO E IMPORTAÇÕES
// ============================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
const fs = require('fs');
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const { WizardScene, Stage } = Scenes;

// ============================================
// CONFIGURAÇÕES DO EXPRESS (para funcionalidades extras, se necessário)
// ============================================
const app = express();
const APP_PORT = process.env.APP_PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ============================================
// ENDPOINT DE GERAÇÃO DO QR CODE (Integração com Pagar.me)
// ============================================
app.post('/gerar-qrcode', async (req, res) => {
  try {
    const { valor } = req.body;
    if (!valor) {
      return res.status(400).json({ error: "Valor não informado" });
    }

    // Utiliza o valor fixo recebido (ex.: 180, 250, 280, etc.)
    const amount = parseFloat(valor);

    const payload = {
      closed: true,
      customer: {
        name: "Tony Stark",
        type: "individual",
        email: "avengerstark@ligadajustica.com.br",
        document: "03154435026",
        address: {
          line_1: "7221, Avenida Dra Ruth Cardoso, Pinheiro",
          line_2: "Prédio",
          zip_code: "05425070",
          city: "São Paulo",
          state: "SP",
          country: "BR"
        },
        phones: {
          home_phone: {
            country_code: "55",
            area_code: "11",
            number: "000000000"
          },
          mobile_phone: {
            country_code: "55",
            area_code: "11",
            number: "000000000"
          }
        }
      },
      items: [
        {
          amount: amount, // Valor fixo conforme a seleção do usuário
          description: "Chaveiro do Tesseract",
          quantity: 1,
          code: 123
        }
      ],
      payments: [
        {
          payment_method: "pix",
          pix: {
            expires_in: "7200",
            additional_information: [
              {
                name: "information",
                value: "number"
              }
            ]
          }
        }
      ]
    };

    // Endpoint da API do Pagar.me
    const endpoint = "https://api.pagar.me/core/v5/orders/";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + Buffer.from("sk_b6abaf16fd1447a6aed99369d0f0fb2e:").toString("base64")
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error("Erro ao gerar QR Code:", error);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
});

// ============================================
// CONSTANTES E DADOS
// ============================================
const TELEGRAM_TOKEN = '7851041101:AAGwv3d2Mz-EFI4yP8sGNAkno84fwDBh92A';

// Tabela de preços fixos para cada produto e quantidade
const PRICE_TABLE = {
  "Fibrada": { "1K": 180, "2K": 360, "3K": 540, "4K": 720 },
  "FKI":     { "1K": 250, "2K": 500, "3K": 750, "4K": 1000 },
  "GameOn":  { "1K": 280, "2K": 560, "3K": 840, "4K": 1120 }
};

// Mapping para exibição dos nomes das categorias
const CATEGORY_DISPLAY_NAMES = {
  "Fibrada": "Fibrada",
  "FKI": "FKI",
  "GameOn": "Game On"
};

const DELIVERY_QUESTIONS = [
  "📍 Qual é o seu endereço de entrega?",
  "📮 Qual é o CEP?",
  "👤 Qual é o nome do recebedor?",
  "🏠 Qual é o número da casa?",
  "🛣️ Qual é o número da rua?",
  "📌 Qual é a referência do endereço?"
];

// ============================================
// HELPERS
// ============================================
const formatCurrency = (value) => `R$ ${value.toFixed(2)}`;

// Cria os botões para a quantidade do produto em uma única linha (horizontal)
const createProductButtons = (category) => {
  const quantities = PRICE_TABLE[category];
  if (!quantities) return []; // Previne erros caso a categoria não exista
  const buttons = Object.entries(quantities).map(([qty, price]) =>
    Markup.button.callback(`${qty} - ${formatCurrency(price)}`, `quantity_${category}_${qty}`)
  );
  return [buttons]; // Retorna uma única linha com todos os botões
};

// ============================================
// WIZARD SCENE
// ============================================
const orderWizard = new WizardScene(
  'orderWizard',
  // Passo 1: Apresentação e exibição da tabela de preços
  async (ctx) => {
    try {
      console.log("Iniciando Passo 1 - Apresentação e tabela de preços");
      // Envia vídeo de apresentação (caso não seja possível, envia mensagem)
      await ctx.replyWithVideo(
        { source: './assets/presentation.mp4' },
        { caption: "🎥 *Bem-vindo à nossa loja!*\nConfira nossa apresentação especial.", parse_mode: 'Markdown' }
      ).catch(async () => {
        await ctx.reply("🎥 *Bem-vindo à nossa loja!*", { parse_mode: 'Markdown' });
      });

      // Monta a tabela de preços com emojis e formatação
      const productTable = Object.entries(PRICE_TABLE)
        .map(([category, prices]) => {
          const displayName = CATEGORY_DISPLAY_NAMES[category] || category;
          const priceList = Object.entries(prices)
            .map(([qty, price]) => `${qty} - ${formatCurrency(price)}`)
            .join('  |  '); // Lista horizontal separada por barra vertical
          return `*${displayName}*: ${priceList}`;
        })
        .join('\n\n');

      await ctx.replyWithMarkdown("💰 *Tabela de Preços*\n\n" + productTable);

      // Exibe os botões de seleção de categoria em uma linha
      await ctx.replyWithMarkdown("📦 *Selecione a categoria do produto:*", Markup.inlineKeyboard([
        Markup.button.callback("🟡 Fibrada", "category_Fibrada"),
        Markup.button.callback("🟢 FKI", "category_FKI"),
        Markup.button.callback("🟣 Game On", "category_GameOn"),
        Markup.button.callback("⬅️ Voltar", "back_main")
      ]));
      return ctx.wizard.next();
    } catch (error) {
      console.error("Erro no Passo 1:", error);
      await ctx.reply("❌ Ocorreu um erro. Por favor, tente novamente.");
      return ctx.scene.leave();
    }
  },

  // Passo 2: Seleção de Categoria
  async (ctx) => {
    try {
      console.log("Passo 2 - Seleção de categoria");
      if (!ctx.callbackQuery) return;
      await ctx.answerCbQuery();
      const data = ctx.callbackQuery.data;
      
      // Trata botão de voltar no menu principal
      if (data === "back_main") {
        await ctx.reply("🏠 Voltando ao menu principal...");
        return ctx.scene.leave();
      }
      
      if (data === "back_video") {
        await ctx.reply("🔙 Retornando à seleção de categoria...");
        return ctx.wizard.back();
      }
      
      if (data.startsWith("category_")) {
        // O callback vem no formato "category_{categoria}"
        const category = data.split("_")[1];
        if (!PRICE_TABLE[category]) {
          await ctx.reply("❌ Categoria não encontrada.");
          return ctx.scene.leave();
        }
        ctx.wizard.state.category = category;
        // Cria os botões de quantidade na horizontal
        const buttons = createProductButtons(category);
        await ctx.replyWithMarkdown(
          `🛍️ *Categoria selecionada: ${CATEGORY_DISPLAY_NAMES[category] || category}*\n\nEscolha a quantidade:`,
          Markup.inlineKeyboard([...buttons, [Markup.button.callback("⬅️ Voltar", "back_video")]])
        );
        return ctx.wizard.next();
      }
    } catch (error) {
      console.error("Erro no Passo 2:", error);
      await ctx.reply("❌ Erro ao selecionar a categoria.");
      return ctx.scene.leave();
    }
  },

  // Passo 3: Seleção da Quantidade e Geração do QR Code PIX
  async (ctx) => {
    try {
      console.log("Passo 3 - Seleção da quantidade e geração do QR Code");
      if (!ctx.callbackQuery) return;
      await ctx.answerCbQuery();
      const data = ctx.callbackQuery.data;
      if (data.startsWith("quantity_")) {
        // O callback deve estar no formato "quantity_{categoria}_{quantidade}"
        const parts = data.split("_");
        if (parts.length < 3) {
          await ctx.reply("❌ Dados inválidos para a quantidade selecionada.");
          return ctx.scene.leave();
        }
        const category = parts[1];
        const qty = parts[2];
        const price = PRICE_TABLE[category] && PRICE_TABLE[category][qty];
        if (!price) {
          await ctx.reply("❌ Preço não encontrado para esta seleção.");
          return ctx.scene.leave();
        }
        console.log(`Gerando QR Code para ${CATEGORY_DISPLAY_NAMES[category]} - ${qty} (valor: ${price})`);
        // Chama o endpoint local (na porta 3000) para gerar o QR Code PIX
        const response = await fetch("http://localhost:3000/gerar-qrcode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ valor: price })
        });
        if (!response.ok) {
          const errorText = await response.text();
          await ctx.reply(`❌ Erro ao gerar o QR Code: ${errorText}`);
          return ctx.scene.leave();
        }
        const dataResponse = await response.json();
        // Verifica se a resposta contém os dados esperados
        if (!dataResponse.charges ||
            !dataResponse.charges[0] ||
            !dataResponse.charges[0].last_transaction ||
            !dataResponse.charges[0].last_transaction.qr_code_url) {
          await ctx.reply("❌ Resposta inválida da API de pagamento.");
          return ctx.scene.leave();
        }
        const qrCodeUrl = dataResponse.charges[0].last_transaction.qr_code_url;
        await ctx.replyWithPhoto(qrCodeUrl);
        await ctx.replyWithMarkdown(`✅ *QR Code PIX gerado com sucesso!*\n\n*Valor:* ${formatCurrency(price)}\n\n*Aguardando Pagamento!⌛️* \n\`\`\`\`\`\``);
      }
    } catch (error) {
      console.error("Erro no Passo 3:", error);
      await ctx.reply("❌ Erro interno ao gerar o QR Code PIX.");
    }
    return ctx.scene.leave();
  }
);

// ============================================
// CONFIGURAÇÃO DO BOT
// ============================================
const stage = new Stage([orderWizard]);
const bot = new Telegraf(TELEGRAM_TOKEN);

bot.use(session());
bot.use(stage.middleware());

// Comando inicial e menu principal
bot.command('start', async (ctx) => {
  try {
    await ctx.replyWithPhoto(
      { source: './assets/menu.jpg' },
      {
        caption: "🛍️ *Bem-vindo à nossa Loja Virtual!*\nEstamos felizes em atendê-lo.",
        parse_mode: 'Markdown'
      }
    ).catch(async () => {
      await ctx.reply("🛍️ *Bem-vindo à nossa Loja Virtual!*", { parse_mode: 'Markdown' });
    });
    await ctx.replyWithMarkdown("*Escolha uma opção:*", Markup.inlineKeyboard([
      Markup.button.callback("🛒 Comprar NF", "BUY_NF"),
      Markup.button.callback("🚚 Envios", "INFO_ENVIOS")
    ], { columns: 2 })); // Botões dispostos em duas colunas
  } catch (error) {
    console.error("Erro no comando /start:", error);
    await ctx.reply("❌ Erro ao exibir o menu. Tente novamente.");
  }
});

// Ações do menu
bot.action('BUY_NF', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.enter('orderWizard');
});

bot.action('INFO_ENVIOS', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(
    "🚚 *Informações de Envio*\n\n" +
    "• *Saída:* SP (segunda a quinta)\n" +
    "• *Horário:* 12:00\n" +
    "• *Método:* Carta registrada\n" +
    "• *Taxa fixa:* R$ 30,00"
  );
});

// ============================================
// INICIALIZAÇÃO DO SERVIDOR E DO BOT
// ============================================
app.listen(APP_PORT, () => {
  console.log(`🚀 Servidor Express (bot.js) rodando na porta ${APP_PORT}`);
});

bot.launch()
  .then(() => console.log('🤖 Bot do Telegram iniciado com sucesso!'))
  .catch((error) => console.error('❌ Erro ao iniciar o bot:', error));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
