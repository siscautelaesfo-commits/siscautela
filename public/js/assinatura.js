// SisCautela · assinatura da cautela e da devolução.
// 1º caminho: biometria do próprio celular (Face ID ou digital), pelo padrão WebAuthn.
//    A biometria nunca sai do aparelho; o app só recebe a confirmação de que foi o dono do celular.
// 2º caminho: a senha do SisCautela, conferida no Firebase (vale em qualquer aparelho).
import {
  EmailAuthProvider, reauthenticateWithCredential
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import { auth, estado, abrirModal, fecharModal, esc, ICONE, traduzirErro } from './nucleo.js';

const chaveCred = () => `siscautela-biometria-${estado.eu?.uid}`;
const lerCred = () => { try { return localStorage.getItem(chaveCred()); } catch { return null; } };
const gravarCred = (id) => { try { localStorage.setItem(chaveCred(), id); } catch { /* sem armazenamento */ } };
const apagarCred = () => { try { localStorage.removeItem(chaveCred()); } catch { /* sem armazenamento */ } };

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const desafio = () => crypto.getRandomValues(new Uint8Array(32));

export async function biometriaDisponivel() {
  try {
    return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

async function registrarBiometria() {
  const eu = estado.eu;
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: desafio(),
      rp: { name: 'SisCautela EsFO' },
      user: { id: new TextEncoder().encode(eu.uid), name: eu.email || eu.uid, displayName: eu.nomeGuerra || 'Militar' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  gravarCred(b64url(cred.rawId));
}

async function conferirBiometria() {
  const id = lerCred();
  await navigator.credentials.get({
    publicKey: {
      challenge: desafio(),
      allowCredentials: [{ type: 'public-key', id: deB64url(id), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
}

/**
 * Abre a janela de assinatura e resolve com { metodo: 'biometria' | 'senha' } quando o militar assina,
 * ou null se ele cancelar.
 */
export function assinar(titulo, resumo) {
  return new Promise(async (resolver) => {
    let concluida = false;
    const terminar = (r) => { if (concluida) return; concluida = true; resolver(r); };
    const temBio = await biometriaDisponivel();
    const cadastrada = !!lerCred();

    const telaBio = () => {
      const m = abrirModal(`
        <div class="assinar">
          <h2>${esc(titulo)}</h2>
          ${resumo ? `<p>${esc(resumo)}</p>` : ''}
          <button type="button" class="digital" data-bio aria-label="Assinar com a biometria do celular">${ICONE.digital}</button>
          <p data-txt>${cadastrada ? 'Toque para confirmar com o Face ID ou a digital do celular.' : 'Primeira vez neste celular: toque para ligar a biometria e assinar.'}</p>
          <div class="linha"><button type="button" class="btn" data-fechar-modal>Cancelar</button>
          <button type="button" class="btn leve" data-senha>Assinar com a senha</button></div>
        </div>`, () => terminar(null));
      m.querySelector('[data-senha]').addEventListener('click', telaSenha);
      m.querySelector('[data-bio]').addEventListener('click', async () => {
        const txt = m.querySelector('[data-txt]');
        try {
          txt.textContent = 'Confirme no celular…';
          if (!lerCred()) await registrarBiometria();
          await conferirBiometria();
          m.querySelector('[data-bio]').classList.add('ok');
          m.querySelector('[data-bio]').innerHTML = ICONE.ok;
          txt.textContent = 'Assinado.';
          setTimeout(() => { concluida = true; fecharModal(); resolver({ metodo: 'biometria' }); }, 450);
        } catch (err) {
          console.warn(err);
          if (err?.name === 'InvalidStateError' || err?.name === 'NotFoundError') apagarCred();
          txt.textContent = 'A biometria não foi confirmada. Tente de novo ou assine com a senha.';
        }
      });
    };

    const telaSenha = () => {
      const m = abrirModal(`
        <form class="assinar" data-form-senha>
          <h2>${esc(titulo)}</h2>
          <p>Digite a sua senha do SisCautela para assinar.</p>
          <label style="width:100%">Senha<input type="password" name="senha" autocomplete="current-password" required></label>
          <p class="pequeno" data-erro hidden style="color:var(--erro)"></p>
          <div class="linha"><button type="button" class="btn" data-fechar-modal>Cancelar</button>
          <button type="submit" class="btn prim">Assinar</button></div>
          ${temBio ? '<button type="button" class="btn leve" data-voltar-bio>Usar a biometria</button>' : ''}
        </form>`, () => terminar(null));
      m.querySelector('[data-voltar-bio]')?.addEventListener('click', telaBio);
      const f = m.querySelector('[data-form-senha]');
      f.senha.focus();
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const erro = m.querySelector('[data-erro]');
        const botao = f.querySelector('[type=submit]');
        botao.disabled = true;
        try {
          const user = auth.currentUser;
          await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, f.senha.value));
          concluida = true;
          fecharModal();
          resolver({ metodo: 'senha' });
        } catch (err) {
          erro.textContent = err?.code === 'auth/invalid-credential' || err?.code === 'auth/wrong-password' ? 'Senha incorreta.' : traduzirErro(err);
          erro.hidden = false;
          botao.disabled = false;
        }
      });
    };

    if (temBio) telaBio(); else telaSenha();
  });
}
