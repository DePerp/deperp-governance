import { expect } from "chai";
import { ethers } from "hardhat";
import { getTypedDomainDeperp, getDelegationTypes } from "./governanceHelpers";
import {
  loadFixture,
  time,
  mine,
} from "@nomicfoundation/hardhat-network-helpers";

describe("Deperp", function () {
  async function deployFixtures() {
    const [owner, otherAccount] = await ethers.getSigners();
    const Deperp = await ethers.getContractFactory("Deperp");
    const deperp = await Deperp.deploy(await owner.getAddress());

    return { owner, otherAccount, deperp };
  }

  describe("Approvals", function () {
    it("Approve", async function () {
      const { owner, otherAccount, deperp } = await loadFixture(deployFixtures);

      await expect(deperp.approve(otherAccount, 100))
        .to.emit(deperp, "Approval")
        .withArgs(owner.address, otherAccount.address, 100);
      expect(await deperp.allowance(owner, otherAccount)).to.eq(100);
    });

    it("Over uint96", async function () {
      const { otherAccount, deperp } = await loadFixture(deployFixtures);

      await expect(
        deperp.approve(otherAccount, ethers.MaxUint256 - 1n),
      ).to.be.revertedWith("Deperp::approve: amount exceeds 96 bits");
    });

    it("Infinite approval", async function () {
      const { otherAccount, deperp, owner } = await loadFixture(deployFixtures);

      await expect(deperp.approve(otherAccount, ethers.MaxUint256))
        .to.emit(deperp, "Approval")
        .withArgs(owner.address, otherAccount.address, 2n ** 96n - 1n);

      await expect(
        deperp.connect(otherAccount).transferFrom(owner, otherAccount, 100),
      ).to.not.emit(deperp, "Approval");

      expect(await deperp.allowance(owner, otherAccount)).to.equal(
        2n ** 96n - 1n,
      );
    });
  });

  describe("Transfer", function () {
    it("happy path", async function () {
      const { owner, otherAccount, deperp } = await loadFixture(deployFixtures);
      await expect(deperp.transfer(otherAccount, 100))
        .to.emit(deperp, "Transfer")
        .withArgs(owner.address, otherAccount.address, 100);
    });

    it("Error: over uint96", async function () {
      const { otherAccount, deperp } = await loadFixture(deployFixtures);
      await expect(
        deperp.transfer(otherAccount, ethers.MaxUint256 - 1n),
      ).to.be.revertedWith("Deperp::transfer: amount exceeds 96 bits");
    });
  });

  describe("Transfer From", function () {
    it("happy path", async function () {
      const { owner, otherAccount, deperp } = await loadFixture(deployFixtures);
      await deperp.approve(otherAccount, 100);
      await expect(
        deperp.connect(otherAccount).transferFrom(owner, otherAccount, 100),
      )
        .to.emit(deperp, "Transfer")
        .withArgs(owner.address, otherAccount.address, 100)
        .to.emit(deperp, "Approval");
      expect(await deperp.balanceOf(otherAccount)).to.eq(100);
      expect(await deperp.allowance(owner, otherAccount)).to.eq(0);
    });

    it("Error: over uint96", async function () {
      const { owner, otherAccount, deperp } = await loadFixture(deployFixtures);
      await expect(
        deperp
          .connect(otherAccount)
          .transferFrom(owner, otherAccount, ethers.MaxUint256 - 1n),
      ).to.be.revertedWith("Deperp::approve: amount exceeds 96 bits");
    });
  });

  describe("Transfer Tokens", function () {
    it("Error: from zero address", async function () {
      const { otherAccount, deperp } = await loadFixture(deployFixtures);
      await expect(
        deperp.transferFrom(ethers.ZeroAddress, otherAccount, 0),
      ).to.be.revertedWith(
        "Deperp::_transferTokens: cannot transfer from the zero address",
      );
    });

    it("Error: to zero address", async function () {
      const { deperp } = await loadFixture(deployFixtures);
      await expect(deperp.transfer(ethers.ZeroAddress, 100)).to.be.revertedWith(
        "Deperp::_transferTokens: cannot transfer to the zero address",
      );
    });

    it("Error: exceeds balance", async function () {
      const { deperp, owner, otherAccount } = await loadFixture(deployFixtures);
      await expect(
        deperp.connect(otherAccount).transfer(owner, 100),
      ).to.be.revertedWith(
        "Deperp::_transferTokens: transfer amount exceeds balance",
      );
    });
  });

  describe("Delegate", function () {
    it("happy path", async function () {
      const { deperp, owner } = await loadFixture(deployFixtures);
      await expect(deperp.delegate(owner))
        .to.emit(deperp, "DelegateChanged")
        .withArgs(owner.address, ethers.ZeroAddress, owner.address);
      expect(await deperp.delegates(owner)).to.eq(owner.address);
      expect(await deperp.getCurrentVotes(owner)).to.eq(
        BigInt("100000000") * 10n ** 18n,
      );
    });

    describe("By sig", function () {
      it("happy path", async function () {
        const { deperp, owner } = await loadFixture(deployFixtures);
        const domain = await getTypedDomainDeperp(
          deperp,
          (await ethers.provider.getNetwork()).chainId,
        );
        const delegationTypes = await getDelegationTypes();

        const sig = await owner.signTypedData(domain, delegationTypes, {
          delegatee: owner.address,
          nonce: 0,
          expiry: (await time.latest()) + 100,
        });
        const r = "0x" + sig.substring(2, 66);
        const s = "0x" + sig.substring(66, 130);
        const v = "0x" + sig.substring(130, 132);

        await expect(
          deperp.delegateBySig(
            owner.address,
            0,
            (await time.latest()) + 100,
            v,
            r,
            s,
          ),
        )
          .to.emit(deperp, "DelegateChanged")
          .withArgs(owner.address, ethers.ZeroAddress, owner.address);
      });

      it("Error: invalid nonce", async function () {
        const { deperp, owner, otherAccount } =
          await loadFixture(deployFixtures);
        const domain = await getTypedDomainDeperp(
          deperp,
          (await ethers.provider.getNetwork()).chainId,
        );
        const delegationTypes = await getDelegationTypes();

        let sig = await owner.signTypedData(domain, delegationTypes, {
          delegatee: owner.address,
          nonce: 0,
          expiry: (await time.latest()) + 100,
        });
        let r = "0x" + sig.substring(2, 66);
        let s = "0x" + sig.substring(66, 130);
        let v = "0x" + sig.substring(130, 132);

        await deperp.delegateBySig(
          owner.address,
          0,
          (await time.latest()) + 100,
          v,
          r,
          s,
        );

        sig = await owner.signTypedData(domain, delegationTypes, {
          delegatee: otherAccount.address,
          nonce: 2,
          expiry: (await time.latest()) + 100,
        });
        r = "0x" + sig.substring(2, 66);
        s = "0x" + sig.substring(66, 130);
        v = "0x" + sig.substring(130, 132);

        await expect(
          deperp.delegateBySig(otherAccount.address, 2, 0, v, r, s),
        ).to.be.revertedWith("Deperp::delegateBySig: invalid nonce");
      });

      it("Error: invalid signature", async function () {
        const { deperp, owner } = await loadFixture(deployFixtures);
        const domain = await getTypedDomainDeperp(
          deperp,
          (await ethers.provider.getNetwork()).chainId,
        );
        const delegationTypes = await getDelegationTypes();

        const sig = await owner.signTypedData(domain, delegationTypes, {
          delegatee: owner.address,
          nonce: 0,
          expiry: (await time.latest()) + 100,
        });
        const r = "0x" + sig.substring(2, 66);
        const s = "0x" + sig.substring(66, 130);
        const v = "0x00";

        await expect(
          deperp.delegateBySig(
            owner.address,
            0,
            (await time.latest()) + 100,
            v,
            r,
            s,
          ),
        ).to.revertedWith("Deperp::delegateBySig: invalid signature");
      });

      it("Error: expired", async function () {
        const { deperp, owner } = await loadFixture(deployFixtures);
        const domain = await getTypedDomainDeperp(
          deperp,
          (await ethers.provider.getNetwork()).chainId,
        );
        const delegationTypes = await getDelegationTypes();

        const sig = await owner.signTypedData(domain, delegationTypes, {
          delegatee: owner.address,
          nonce: 0,
          expiry: (await time.latest()) - 100,
        });
        const r = "0x" + sig.substring(2, 66);
        const s = "0x" + sig.substring(66, 130);
        const v = "0x" + sig.substring(130, 132);

        await expect(
          deperp.delegateBySig(
            owner.address,
            0,
            (await time.latest()) - 100,
            v,
            r,
            s,
          ),
        ).to.be.revertedWith("Deperp::delegateBySig: signature expired");
      });
    });
  });

  describe("Get current votes", function () {
    it("Happy path", async function () {
      const { deperp, owner } = await loadFixture(deployFixtures);
      expect(await deperp.getCurrentVotes(owner)).to.eq(0);

      await deperp.delegate(owner);
      expect(await deperp.getCurrentVotes(owner)).to.eq(
        100000000n * 10n ** 18n,
      );
    });
  });

  describe("Get prior votes", function () {
    it("happy path", async function () {
      const { deperp, otherAccount } = await loadFixture(deployFixtures);
      await deperp.transfer(otherAccount, 100);
      const blockNumber1 = await ethers.provider.getBlockNumber();
      await deperp.connect(otherAccount).delegate(otherAccount);
      await mine(100);
      await deperp.transfer(otherAccount, 100);
      const blockNumber2 = await ethers.provider.getBlockNumber();
      await mine();
      await deperp.transfer(otherAccount, 200);
      const blockNumber3 = await ethers.provider.getBlockNumber();
      await mine();

      expect(await deperp.getPriorVotes(otherAccount, blockNumber1 - 1)).to.eq(
        0,
      );
      expect(await deperp.getPriorVotes(otherAccount, blockNumber1)).to.eq(0);
      expect(await deperp.getPriorVotes(otherAccount, blockNumber2)).to.eq(200);
      expect(await deperp.getPriorVotes(otherAccount, blockNumber3 - 1)).to.eq(
        200,
      );
      expect(await deperp.getPriorVotes(otherAccount, blockNumber3)).to.eq(400);
    });

    it("Happy path: new account", async function () {
      const { deperp, otherAccount } = await loadFixture(deployFixtures);
      const blockNumber1 = await ethers.provider.getBlockNumber();
      await mine();
      expect(await deperp.getPriorVotes(otherAccount, blockNumber1)).to.eq(0);
    });

    it("Error: block number must be past", async function () {
      const { deperp, owner } = await loadFixture(deployFixtures);
      const blockNumber = await ethers.provider.getBlockNumber();

      await expect(deperp.getPriorVotes(owner, blockNumber)).to.be.revertedWith(
        "Deperp::getPriorVotes: not yet determined",
      );
    });
  });

  describe("Move delegates", function () {
    it("Move from owner to other account", async function () {
      const { deperp, owner, otherAccount } = await loadFixture(deployFixtures);
      await deperp.delegate(owner);
      await deperp.connect(otherAccount).delegate(otherAccount);

      await expect(deperp.transfer(otherAccount, 100))
        .to.emit(deperp, "DelegateVotesChanged")
        .withArgs(otherAccount.address, 0, 100)
        .to.emit(deperp, "DelegateVotesChanged")
        .withArgs(
          owner.address,
          100000000n * 10n ** 18n,
          100000000n * 10n ** 18n - 100n,
        );
    });

    it("Delegate to zero address", async function () {
      const { deperp, owner } = await loadFixture(deployFixtures);
      await deperp.delegate(owner);
      await deperp.delegate(ethers.ZeroAddress);
      expect(await deperp.getCurrentVotes(owner)).to.eq(0);
    });

    it("Move delegates twice in one block", async function () {
      const { deperp, owner, otherAccount } = await loadFixture(deployFixtures);
      const Multicall = await ethers.getContractFactory("Multicall");
      const multicall = await Multicall.deploy();

      await deperp.transfer(otherAccount, 100);

      const domain = await getTypedDomainDeperp(
        deperp,
        (await ethers.provider.getNetwork()).chainId,
      );
      const delegationTypes = await getDelegationTypes();

      const expiry = (await time.latest()) + 100;
      const sig = await owner.signTypedData(domain, delegationTypes, {
        delegatee: otherAccount.address,
        nonce: 0,
        expiry,
      });
      const r = "0x" + sig.substring(2, 66);
      const s = "0x" + sig.substring(66, 130);
      const v = "0x" + sig.substring(130, 132);

      const sig2 = await otherAccount.signTypedData(domain, delegationTypes, {
        delegatee: otherAccount.address,
        nonce: 0,
        expiry,
      });
      const r2 = "0x" + sig2.substring(2, 66);
      const s2 = "0x" + sig2.substring(66, 130);
      const v2 = "0x" + sig2.substring(130, 132);

      const calldata1 = (
        await deperp.delegateBySig.populateTransaction(
          otherAccount.address,
          0,
          expiry,
          v,
          r,
          s,
        )
      ).data;

      const calldata2 = (
        await deperp.delegateBySig.populateTransaction(
          otherAccount.address,
          0,
          expiry,
          v2,
          r2,
          s2,
        )
      ).data;

      await multicall.aggregate([
        { target: await deperp.getAddress(), callData: calldata1 },
        { target: await deperp.getAddress(), callData: calldata2 },
      ]);
    });
  });
});
