// THIS SCRIPT IS TO BE COPIED AND PASTED INTO A CHROME CONSOLE

function connectMe() {
  async function connectMeAsync() {
    try {
      const sleepRandomly = () => {
        const randomSleepInMs = parseInt(Math.random() * 1000) + 1000;

        return new Promise(resolve => setTimeout(resolve, randomSleepInMs));
      };

      const allConnectButtons = $('button')
        .toArray()
        .filter(b => b.innerText === 'Connect');

      for (let connectButton of allConnectButtons) {
        await sleepRandomly();
        connectButton.click();
        $('html, body').animate(
          {
            scrollTop:
              $(connectButton)
                .first()
                .offset().top - 500,
          },
          500
        );

        await sleepRandomly();
        let sendNowButton = $('button')
          .toArray()
          .filter(b => b.innerText === 'Send now')[0];

        sendNowButton.click();
      }

      await sleepRandomly();
      $('button.next')
        .toArray()[0]
        .click();
    } catch (err) {
      console.log('WHAT HAPPENED HERE!??');
      console.log({ err });
    }
  }

  connectMeAsync()
    .then(() => {
      console.log('Done connecting...');
    })
    .catch(e => {
      console.log('OH NO, something went wrong');
      console.log({ error: e });
    });
}
