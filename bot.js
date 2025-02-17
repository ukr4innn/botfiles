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
// CONFIGURAÇÕES DO EXPRESS
// ============================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ============================================
// CONSTANTES E DADOS
// ============================================
const TELEGRAM_TOKEN = '7851041101:AAGwv3d2Mz-EFI4yP8sGNAkno84fwDBh92A';
const PAGARME_KEY = 'sk_b6abaf16fd1447a6aed99369d0f0fb2e';

const PRICE_TABLE = {
  "Fibrada": { 
    "1K": 180, 
    "2K": 360, 
    "3K": 540, 
    "4K": 720 
  },
  "FKI": { 
    "1K": 250, 
    "2K": 500, 
    "3K": 750, 
    "4K": 1000 
  },
  "GameOn": { 
    "1K": 280, 
    "2K": 560, 
    "3K": 840, 
    "4K": 1120 
  }
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
// FUNÇÕES AUXILIARES
// ============================================
const formatCurrency = (value) => `R$ ${value.toFixed(2)}`;

const createProductButtons = (category) => {
  try {
    const normalizedCategory = category.replace(/\s+/g, '');
    const prices = PRICE_TABLE[normalizedCategory];
    
    if (!prices) {
      console.error(`Categoria não encontrada: ${category}`);
      return [[Markup.button.callback("⬅️ Voltar", "back_video")]];
    }

    const buttons = Object.entries(prices).map(([qty, price]) => [
      Markup.button.callback(
        `${qty} - ${formatCurrency(price)}`,
        `quantity_${qty}`
      )
    ]);

    buttons.push([Markup.button.callback("⬅️ Voltar", "back_video")]);
    return buttons;
  } catch (error) {
    console.error('Erro ao criar botões:', error);
    return [[Markup.button.callback("⬅️ Voltar", "back_video")]];
  }
};

// Função para gerar QR Code do PIX
const generatePixQRCode = async (valor) => {
  try {
    // Converte o valor para centavos
    const amountCents = Math.round(Number.parseFloat(valor) * 100);

    // Monta o payload para a API do Pagar.me
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
          country: "BR",
        },
        phones: {
          home_phone: {
            country_code: "55",
            area_code: "11",
            number: "000000000",
          },
          mobile_phone: {
            country_code: "55",
            area_code: "11",
            number: "000000000",
          },
        },
      },
      items: [
        {
          amount: amountCents,
          description: "Adição de Saldo",
          quantity: 1,
          code: 123,
        },
      ],
      payments: [
        {
          payment_method: "pix",
          pix: {
            expires_in: "7200", // Expiração do PIX em 2 horas
            additional_information: [
              {
                name: "Saldo",
                value: valor.toString(),
              },
            ],
          },
        },
      ],
    };

    // Endpoint da API do Pagar.me para produção
    const endpoint = "https://api.pagar.me/core/v5/orders/";

    // Realiza a requisição à API do Pagar.me em produção
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(PAGARME_KEY + ':').toString('base64'),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro HTTP: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Erro ao gerar QR Code:', error);
    throw error;
  }
};



// Função para verificar o status do pagamento
const checkPaymentStatus = async (orderId) => {
  try {
    const response = await fetch(`http://localhost:3000/verificar-status?orderId=${orderId}`);
    if (!response.ok) {
      throw new Error(`Erro ao verificar status do pedido: ${response.status}`);
    }
    const data = await response.json();
    return data.status;
  } catch (error) {
    console.error('Erro ao verificar status do pagamento:', error);
    throw error;
  }
};

// ============================================
// CENA DO PEDIDO
// ============================================
const orderWizard = new WizardScene(
  'orderWizard',
  // Passo 1: Apresentação
  async (ctx) => {
    try {
      // Inicializa o estado do pedido
      ctx.wizard.state.order = [];
      
      try {
        await ctx.replyWithVideo(
          { source: './assets/presentation.mp4' },
          { 
            caption: "🎥 *Bem-vindo à nossa loja!*", 
            parse_mode: 'Markdown' 
          }
        );
      } catch (error) {
        console.log('Vídeo não encontrado:', error);
        await ctx.reply("🎥 *Bem-vindo à nossa loja!*", { parse_mode: 'Markdown' });
      }

      const productTable = Object.entries(PRICE_TABLE)
        .map(([category, prices]) => {
          const priceList = Object.entries(prices)
            .map(([qty, price]) => `${qty} - ${formatCurrency(price)}`)
            .join('\n');
          return `*${category}*:\n${priceList}`;
        })
        .join('\n\n');

      await ctx.reply("💰 *Tabela de Preços*\n\n" + productTable, { 
        parse_mode: 'Markdown' 
      });

      await ctx.reply("📦 *Selecione a categoria do produto:*", {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🟡 Fibrada", "category_Fibrada")],
          [Markup.button.callback("🟢 FKI", "category_FKI")],
          [Markup.button.callback("🟣 Game On", "category_GameOn")],
          [Markup.button.callback("⬅️ Voltar ao Menu", "back_main")]
        ])
      });

      return ctx.wizard.next();
    } catch (error) {
      console.error("Erro no passo 1:", error);
      await ctx.reply("❌ Ocorreu um erro. Por favor, tente novamente.");
      return ctx.scene.leave();
    }
  },

  // Passo 2: Seleção de Categoria
  async (ctx) => {
    try {
      if (!ctx.callbackQuery) return;

      await ctx.answerCbQuery().catch(console.error);
      const data = ctx.callbackQuery.data;

      if (data === "back_main") {
        await ctx.reply("🏠 Voltando ao menu principal...");
        return ctx.scene.leave();
      }

      if (data.startsWith("category_")) {
        const category = data.split("_")[1];
        ctx.wizard.state.currentCategory = category;

        const buttons = createProductButtons(category);

        await ctx.reply(
          `🛍️ *Categoria selecionada: ${category}*\n\nEscolha a quantidade:`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
          }
        );

        return ctx.wizard.next();
      }
    } catch (error) {
      console.error("Erro no passo 2:", error);
      await ctx.reply("❌ Ocorreu um erro. Por favor, tente novamente.");
      return ctx.scene.leave();
    }
  },

 // Passo 3: Seleção de Quantidade e Geração do PIX
async (ctx) => {
  try {
    if (!ctx.callbackQuery) return;

    await ctx.answerCbQuery().catch(console.error);
    const data = ctx.callbackQuery.data;

    if (data === "back_video") {
      return ctx.wizard.selectStep(0);
    }

    if (data.startsWith("quantity_")) {
      const quantity = data.split("_")[1];
      const category = ctx.wizard.state.currentCategory;
      const normalizedCategory = category.replace(/\s+/g, '');
      const price = PRICE_TABLE[normalizedCategory][quantity];

      // Salva os detalhes do pedido
      ctx.wizard.state.selectedQuantity = quantity;
      ctx.wizard.state.selectedPrice = price;

      await ctx.reply(
        `✅ *Pedido Selecionado*\n\nCategoria: ${category}\nQuantidade: ${quantity}\nValor: ${formatCurrency(price)}`,
        { parse_mode: 'Markdown' }
      );

      // Gera o QR Code do PIX
      try {
        const paymentData = await generatePixQRCode(price);
        
        if (paymentData.charges && paymentData.charges[0].last_transaction.qr_code) {
          const qrCode = paymentData.charges[0].last_transaction.qr_code;
          const qrCodeUrl = paymentData.charges[0].last_transaction.qr_code_url;
          
          await ctx.reply(
            "💳 *Dados do Pagamento PIX*\n\n" +
            `Valor: ${formatCurrency(price)}\n\n` +
            "Copie o código PIX abaixo:",
            { parse_mode: 'Markdown' }
          );

          await ctx.reply(qrCode);
          
          if (qrCodeUrl) {
            await ctx.reply("🔍 QR Code gerado com sucesso! Escaneie para pagar.");
          }

          // Verifica o pagamento após um tempo ou baseado em evento
          setTimeout(async () => {
            try {
              const status = await checkPaymentStatus(ctx.wizard.state.orderId);
              if (status === "paid") {
                await ctx.reply("✅ Pagamento confirmado! Seu pedido será processado.");
              } else {
                await ctx.reply("⚠️ Pagamento ainda não confirmado. Tente novamente mais tarde.");
              }
            } catch (error) {
              console.error('Erro ao verificar pagamento:', error);
              await ctx.reply("❌ Não foi possível verificar o pagamento. Por favor, verifique manualmente.");
            }
          }, 5000); // Aguarda 5 segundos antes de verificar
        } else {
          throw new Error('Dados do PIX não encontrados na resposta');
        }
      } catch (error) {
        console.error('Erro ao gerar PIX:', error);
        await ctx.reply("❌ Erro ao gerar o PIX. Por favor, tente novamente.");
      }

      await ctx.reply(
        "Deseja fazer outro pedido?",
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Sim", "new_order")],
          [Markup.button.callback("❌ Não", "finish_order")]
        ])
      );

      return ctx.wizard.next();
    }
  } catch (error) {
    console.error("Erro no passo 3:", error);
    await ctx.reply("❌ Ocorreu um erro. Por favor, tente novamente.");
    return ctx.scene.leave();
  }
},

  // Passo 4: Finalização ou Novo Pedido
  async (ctx) => {
    try {
      if (!ctx.callbackQuery) return;

      await ctx.answerCbQuery().catch(console.error);
      const data = ctx.callbackQuery.data;

      if (data === "new_order") {
        return ctx.wizard.selectStep(0);
      } else if (data === "finish_order") {
        await ctx.reply("👋 Obrigado pela preferência! Volte sempre!");
        return ctx.scene.leave();
      }
    } catch (error) {
      console.error("Erro no passo 4:", error);
      await ctx.reply("❌ Ocorreu um erro. Por favor, tente novamente.");
      return ctx.scene.leave();
    }
  }
);

// ============================================
// CONFIGURAÇÃO DO BOT
// ============================================
const stage = new Stage([orderWizard]);
const bot = new Telegraf(TELEGRAM_TOKEN);

bot.use(session());
bot.use(stage.middleware());

bot.command('start', async (ctx) => {
  try {
    await ctx.reply("🛍️ *Bem-vindo à nossa Loja Virtual!*", {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🛒 Fazer Pedido", "BUY_NF")],
        [Markup.button.callback("ℹ️ Informações", "INFO")]
      ])
    });
  } catch (error) {
    console.error("Erro no comando start:", error);
    await ctx.reply("❌ Erro ao iniciar. Tente novamente.");
  }
});

bot.action('BUY_NF', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.enter('orderWizard');
});

bot.action('INFO', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "ℹ️ *Informações*\n\n" +
    "• Entrega em todo Brasil\n" +
    "• Pagamento via PIX\n" +
    "• Suporte 24/7\n\n" +
    "Para fazer um pedido, use o comando /start",
    { parse_mode: 'Markdown' }
  );
});

// ============================================
// INICIALIZAÇÃO
// ============================================
Promise.all([
  app.listen(PORT, () => {
    console.log(`🚀 Servidor Express rodando na porta ${PORT}`);
  }),
  bot.launch()
]).then(() => {
  console.log('🤖 Bot e servidor iniciados com sucesso!');
}).catch((error) => {
  console.error('❌ Erro ao iniciar:', error);
});

// Graceful shutdown
process.once('SIGINT', () => {
  bot.stop('SIGINT');
  process.exit(0);
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  process.exit(0);
});
