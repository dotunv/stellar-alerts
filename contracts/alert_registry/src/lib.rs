#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, panic_with_error, symbol_short, Address, Env, String,
    Symbol,
};

const REGISTRATION_KEY: Symbol = symbol_short!("REGISTERED");
const ADMIN_KEY: Symbol = symbol_short!("ADMIN");
const CONFIG_KEY: Symbol = symbol_short!("CONFIG");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    AlreadyInitialized = 2,
    NotInitialized = 3,
}

#[contract]
pub struct AlertRegistryContract;

#[contractimpl]
impl AlertRegistryContract {
    /// Initializes the contract with an admin governance address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&ADMIN_KEY) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&ADMIN_KEY, &admin);
        Ok(())
    }

    /// Returns the current registered admin address if set.
    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&ADMIN_KEY)
    }

    /// Updates the admin governance address. Only authorized by the current admin.
    pub fn set_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), Error> {
        admin.require_auth();

        let current_admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN_KEY)
            .ok_or(Error::NotInitialized)?;

        if admin != current_admin {
            panic_with_error!(&env, Error::Unauthorized);
        }

        env.storage().instance().set(&ADMIN_KEY, &new_admin);
        Ok(())
    }

    /// Updates a contract configuration parameter (admin governance).
    pub fn update_config(
        env: Env,
        admin: Address,
        key: Symbol,
        value: String,
    ) -> Result<(), Error> {
        admin.require_auth();

        let current_admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN_KEY)
            .ok_or(Error::NotInitialized)?;

        if admin != current_admin {
            panic_with_error!(&env, Error::Unauthorized);
        }

        env.storage().instance().set(&(CONFIG_KEY, key), &value);
        Ok(())
    }

    /// Retrieves a contract configuration parameter by symbol key.
    pub fn get_config(env: Env, key: Symbol) -> Option<String> {
        env.storage().instance().get(&(CONFIG_KEY, key))
    }

    /// Registers an alert listener preference on-chain for a user address.
    pub fn register_listener(env: Env, user: Address, channel: Symbol, target: String) {
        user.require_auth();

        // Store user preference in instance storage
        env.storage().instance().set(&(user.clone(), channel.clone()), &target);

        // Publish event for off-chain ingestion watchers
        env.events().publish((REGISTRATION_KEY, user, channel), target);
    }

    /// Queries the registered alert target for a given user and channel.
    pub fn get_listener(env: Env, user: Address, channel: Symbol) -> Option<String> {
        env.storage().instance().get(&(user, channel))
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_initialize_and_admin_governance() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AlertRegistryContract);
        let client = AlertRegistryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let new_admin = Address::generate(&env);

        // Initialize contract with admin
        client.initialize(&admin);
        assert_eq!(client.get_admin(), Some(admin.clone()));

        // Update admin as authorized admin
        client.set_admin(&admin, &new_admin);
        assert_eq!(client.get_admin(), Some(new_admin));
    }

    #[test]
    fn test_admin_config_update() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AlertRegistryContract);
        let client = AlertRegistryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let key = symbol_short!("FEE");
        let val = String::from_str(&env, "10");

        client.update_config(&admin, &key, &val);
        assert_eq!(client.get_config(&key), Some(val));
    }

    #[test]
    fn test_register_and_get_listener() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AlertRegistryContract);
        let client = AlertRegistryContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        let channel = symbol_short!("DISCORD");
        let target = String::from_str(&env, "https://discord.com/webhook/123");

        client.register_listener(&user, &channel, &target);
        assert_eq!(client.get_listener(&user, &channel), Some(target));
    }

    #[test]
    #[should_panic]
    fn test_unauthorized_admin_update_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AlertRegistryContract);
        let client = AlertRegistryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);

        client.initialize(&admin);

        // Attacker attempts to update admin (must panic with Error::Unauthorized)
        client.set_admin(&attacker, &attacker);
    }
}
