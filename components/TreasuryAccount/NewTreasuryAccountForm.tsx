/* eslint-disable @typescript-eslint/no-non-null-asserted-optional-chain */
import BaseGovernanceForm, {
  BaseGovernanceFormFieldsV2,
} from 'components/AssetsList/BaseGovernanceForm'
import Button from 'components/Button'
import Input from 'components/inputs/Input'
import PreviousRouteBtn from 'components/PreviousRouteBtn'
import useQueryContext from 'hooks/useQueryContext'
import useRealm from 'hooks/useRealm'
import {
  GovernanceConfig,
  PROGRAM_VERSION_V1,
  RpcContext,
  VoteTipping,
} from '@solana/spl-governance'
import { MintInfo } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import { tryParseKey } from 'tools/validators/pubkey'
import { debounce } from 'utils/debounce'
import { isFormValid } from 'utils/formValidation'
import { getGovernanceConfigFromV2Form } from '@utils/GovernanceTools'
import { notify } from 'utils/notifications'
import tokenPriceService, {
  TokenInfoWithoutDecimals,
} from '@utils/services/tokenPrice'
import { TokenProgramAccount, tryGetMint } from 'utils/tokens'
import { createTreasuryAccount } from 'actions/createTreasuryAccount'
import { useRouter } from 'next/router'
import React, { useEffect, useState } from 'react'
import useWalletStore from 'stores/useWalletStore'
import * as yup from 'yup'
import { DEFAULT_NFT_TREASURY_MINT } from '@components/instructions/tools'
import { MIN_COMMUNITY_TOKENS_TO_CREATE_W_0_SUPPLY } from '@tools/constants'
import { getProgramVersionForRealm } from '@models/registry/api'
import Select from '@components/inputs/Select'
import useVotePluginsClientStore from 'stores/useVotePluginsClientStore'
import { getMintDecimalAmount } from '@tools/sdk/units'
import {
  transformerBaseGovernanceFormFieldsV3_2_GovernanceConfig,
  transform,
  BaseGovernanceFormFieldsV3,
} from '@components/AssetsList/BaseGovernanceForm-data'
import useProgramVersion from '@hooks/useProgramVersion'

type NewTreasuryAccountForm = (
  | BaseGovernanceFormFieldsV3
  | BaseGovernanceFormFieldsV2
) & {
  mintAddress: string
}

const SOL = 'SOL'
const OTHER = 'OTHER'
const NFT = 'NFT'

const NewAccountForm = () => {
  const router = useRouter()
  const client = useVotePluginsClientStore(
    (s) => s.state.currentRealmVotingClient
  )
  const [types, setTypes] = useState<any[]>([])
  const { fmtUrlWithCluster } = useQueryContext()
  const isCurrentVersionHigherThenV1 = () => {
    return (
      (realmInfo?.programVersion &&
        realmInfo.programVersion > PROGRAM_VERSION_V1) ||
      false
    )
  }
  const {
    realmInfo,
    realm,
    mint: realmMint,
    councilMint,
    symbol,
    ownVoterWeight,
  } = useRealm()
  useEffect(() => {
    const accTypes = [
      {
        name: 'SOL Account',
        value: SOL,
        defaultMint: '',
        hide: !isCurrentVersionHigherThenV1(),
      },
      {
        name: 'Token Account',
        value: OTHER,
        defaultMint: '',
        hide: isCurrentVersionHigherThenV1(),
      },
      {
        name: 'NFT Account',
        value: NFT,
        defaultMint: DEFAULT_NFT_TREASURY_MINT,
        hide: isCurrentVersionHigherThenV1(),
      },
    ]
    setTypes(accTypes)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO please fix, it can cause difficult bugs. You might wanna check out https://bobbyhadz.com/blog/react-hooks-exhaustive-deps for info. -@asktree
  }, [realmInfo?.programVersion])
  const filteredTypes = types.filter((x) => !x.hide)
  const wallet = useWalletStore((s) => s.current)
  const connection = useWalletStore((s) => s.connection)
  const connected = useWalletStore((s) => s.connected)
  const { fetchRealm } = useWalletStore((s) => s.actions)
  const [form, setForm] = useState<NewTreasuryAccountForm>()
  const [tokenInfo, setTokenInfo] = useState<
    TokenInfoWithoutDecimals | undefined
  >(undefined)
  const [mint, setMint] = useState<TokenProgramAccount<MintInfo> | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [formErrors, setFormErrors] = useState({})
  const [treasuryType, setTreasuryType] = useState<any>(null)
  const tokenOwnerRecord = ownVoterWeight.canCreateGovernanceUsingCouncilTokens()
    ? ownVoterWeight.councilTokenRecord
    : realm && ownVoterWeight.canCreateGovernanceUsingCommunityTokens(realm)
    ? ownVoterWeight.communityTokenRecord
    : undefined

  const programVersion = useProgramVersion()

  useEffect(() => {
    if (realm === undefined) return

    if (programVersion <= 2) {
      setForm({
        _programVersion: 2,
        mintAddress: '',
        minInstructionHoldUpTime: 0,
        maxVotingTime: 3,
        voteThreshold: 60,
        minCommunityTokensToCreateProposal: (realmMint?.supply.isZero()
          ? MIN_COMMUNITY_TOKENS_TO_CREATE_W_0_SUPPLY
          : realmMint
          ? getMintDecimalAmount(realmMint!, realmMint!.supply).toNumber() *
            0.01
          : 0
        ).toString(),
      })
    } else {
      setForm({
        _programVersion: 3,
        /* in days */
        minInstructionHoldUpTime: '0',
        /* in days */
        maxVotingTime: '3',
        minCommunityTokensToCreateProposal: '1',
        minCouncilTokensToCreateProposal: '0',
        votingCoolOffTime: '12',
        depositExemptProposalCount: '10',
        communityVoteThreshold: '60',
        communityVetoVoteThreshold: 'disabled',
        councilVoteThreshold: '60',
        councilVetoVoteThreshold: '60',
        councilVoteTipping: VoteTipping.Strict,
        mintAddress: '',
      })
    }
    // realmMint needs to be memoized.......
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realm, programVersion, JSON.stringify(realmMint)])

  const handleSetForm = ({ propertyName, value }) => {
    if (form === undefined) return
    setFormErrors({})
    setForm({ ...form, [propertyName]: value })
  }
  useEffect(() => {
    setTreasuryType(filteredTypes[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO please fix, it can cause difficult bugs. You might wanna check out https://bobbyhadz.com/blog/react-hooks-exhaustive-deps for info. -@asktree
  }, [filteredTypes.length])
  const handleCreate = async () => {
    if (!form) return
    try {
      if (!realm) {
        throw 'No realm selected'
      }
      if (!connected) {
        throw 'Please connect your wallet'
      }
      if (!tokenOwnerRecord) {
        throw "You don't have enough governance power to create a new treasury account"
      }
      const { isValid, validationErrors } = await isFormValid(schema, form)
      setFormErrors(validationErrors)
      if (isValid && realmMint) {
        setIsLoading(true)

        const rpcContext = new RpcContext(
          new PublicKey(realm.owner.toString()),
          getProgramVersionForRealm(realmInfo!),
          wallet!,
          connection.current,
          connection.endpoint
        )

        const governanceConfig =
          form._programVersion === 2
            ? getGovernanceConfigFromV2Form(realmInfo!.programVersion!, {
                minTokensToCreateProposal:
                  form.minCommunityTokensToCreateProposal,
                minInstructionHoldUpTime: form.minInstructionHoldUpTime,
                maxVotingTime: form.maxVotingTime,
                voteThresholdPercentage: form.voteThreshold,
                mintDecimals: realmMint.decimals,
              })
            : new GovernanceConfig(
                transform(
                  transformerBaseGovernanceFormFieldsV3_2_GovernanceConfig(
                    realmMint.decimals,
                    councilMint?.decimals || 0
                  ),
                  { ...form, communityVoteTipping: VoteTipping.Disabled }
                )[0]
              )

        await createTreasuryAccount(
          rpcContext,
          realm,
          treasuryType?.value === SOL ? null : new PublicKey(form.mintAddress),
          governanceConfig,
          tokenOwnerRecord!,
          client
        )
        setIsLoading(false)
        fetchRealm(realmInfo!.programId, realmInfo!.realmId)
        router.push(fmtUrlWithCluster(`/dao/${symbol}/`))
      }
    } catch (e) {
      console.error('Create Treasury', e)
      //TODO how do we present errors maybe something more generic ?
      notify({
        type: 'error',
        message: `Can't create governance`,
        description: `Transaction error ${e}`,
      })
      setIsLoading(false)
    }
  }
  const handleSetDefaultMintError = () => {
    const mintError = { mintAddress: 'Invalid mint address' }
    setFormErrors(mintError)
    setMint(null)
    setTokenInfo(undefined)
  }

  const schema = yup.object().shape({
    mintAddress: yup
      .string()
      .test(
        'mintAddressTest',
        'Mint address validation error',
        async function (val: string) {
          if (treasuryType.value === SOL) {
            return true
          }
          if (val) {
            try {
              const pubKey = tryParseKey(val)
              if (!pubKey) {
                return this.createError({
                  message: `Invalid mint address`,
                })
              }

              const accountData = await connection.current.getAccountInfo(
                pubKey
              )
              if (!accountData) {
                return this.createError({
                  message: `Account not found`,
                })
              }
              const mint = tryGetMint(connection.current, pubKey)
              if (!mint) {
                return this.createError({
                  message: `Account is not a valid mint`,
                })
              }
              return true
            } catch (e) {
              return this.createError({
                message: `Invalid mint address`,
              })
            }
          } else {
            return this.createError({
              message: `Mint address is required`,
            })
          }
        }
      ),
  })
  useEffect(() => {
    if (form.mintAddress) {
      debounce.debounceFcn(async () => {
        const pubKey = tryParseKey(form.mintAddress)
        if (pubKey) {
          const mintAccount = await tryGetMint(connection.current, pubKey)
          if (mintAccount) {
            setMint(mintAccount)
            const info = tokenPriceService.getTokenInfo(form.mintAddress)
            setTokenInfo(info)
          } else {
            handleSetDefaultMintError()
          }
        } else {
          handleSetDefaultMintError()
        }
      })
    } else {
      setMint(null)
      setTokenInfo(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO please fix, it can cause difficult bugs. You might wanna check out https://bobbyhadz.com/blog/react-hooks-exhaustive-deps for info. -@asktree
  }, [form?.mintAddress])

  useEffect(() => {
    handleSetForm({
      value: treasuryType?.defaultMint,
      propertyName: 'mintAddress',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO please fix, it can cause difficult bugs. You might wanna check out https://bobbyhadz.com/blog/react-hooks-exhaustive-deps for info. -@asktree
  }, [treasuryType])
  useEffect(() => {
    setForm({
      ...form,
      minCommunityTokensToCreateProposal: (realmMint?.supply.isZero()
        ? MIN_COMMUNITY_TOKENS_TO_CREATE_W_0_SUPPLY
        : realmMint
        ? getMintDecimalAmount(realmMint!, realmMint!.supply).toNumber() * 0.01
        : 0
      ).toString(),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO please fix, it can cause difficult bugs. You might wanna check out https://bobbyhadz.com/blog/react-hooks-exhaustive-deps for info. -@asktree
  }, [JSON.stringify(realmMint)])
  return form === undefined ? null : (
    <div className="space-y-3">
      <PreviousRouteBtn />
      <div className="border-b border-fgd-4 pb-4 pt-2">
        <div className="flex items-center justify-between">
          <h1>Create new DAO wallet</h1>
        </div>
      </div>

      {filteredTypes.length > 1 && (
        <Select
          label={'Type'}
          onChange={setTreasuryType}
          placeholder="Please select..."
          value={treasuryType?.name}
        >
          {filteredTypes.map((x) => {
            return (
              <Select.Option key={x.value} value={x}>
                {x.name}
              </Select.Option>
            )
          })}
        </Select>
      )}

      {treasuryType?.value === OTHER && (
        <>
          <Input
            label="Mint address"
            value={form.mintAddress}
            type="text"
            onChange={(evt) =>
              handleSetForm({
                value: evt.target.value,
                propertyName: 'mintAddress',
              })
            }
            error={formErrors['mintAddress']}
          />
          {tokenInfo ? (
            <div className="flex items-center">
              {tokenInfo?.logoURI && (
                <img
                  className="flex-shrink-0 h-6 w-6 mr-2.5"
                  src={tokenInfo.logoURI}
                />
              )}
              <div>
                {tokenInfo.name}
                <p className="text-fgd-3 text-xs">{tokenInfo?.symbol}</p>
              </div>
            </div>
          ) : mint ? (
            <div>Mint found</div>
          ) : null}
        </>
      )}
      <BaseGovernanceForm
        formErrors={formErrors}
        form={form}
        setForm={setForm}
        setFormErrors={setFormErrors}
      ></BaseGovernanceForm>
      <div className="border-t border-fgd-4 flex justify-end mt-6 pt-6 space-x-4">
        <Button
          tooltipMessage={!connected ? 'Please connect your wallet' : ''}
          disabled={!connected || isLoading}
          isLoading={isLoading}
          onClick={handleCreate}
        >
          Create
        </Button>
      </div>
    </div>
  )
}

export default NewAccountForm
