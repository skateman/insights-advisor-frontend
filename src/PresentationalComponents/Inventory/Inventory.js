import './_Inventory.scss';

import React, { useEffect, useState } from 'react';
import { TableVariant, sortable, wrappable } from '@patternfly/react-table';
import { urlBuilder, workloadQueryBuilder } from '../Common/Tables';
import { useDispatch, useSelector } from 'react-redux';

import API from '../../Utilities/Api';
import AnsibeTowerIcon from '@patternfly/react-icons/dist/js/icons/ansibeTower-icon';
import DisableRule from '../../PresentationalComponents/Modals/DisableRule';
import { InventoryTable } from '@redhat-cloud-services/frontend-components/Inventory';
import Loading from '../Loading/Loading';
import PropTypes from 'prop-types';
import { RULES_FETCH_URL } from '../../AppConstants';
import RemediationButton from '@redhat-cloud-services/frontend-components-remediations/RemediationButton';
import { getRegistry } from '@redhat-cloud-services/frontend-components-utilities/Registry';
import { mergeArraysByDiffKeys } from '../Common/Tables';
import messages from '../../Messages';
import { addNotification as notification } from '@redhat-cloud-services/frontend-components-notifications/';
import { systemReducer } from '../../AppReducer';
import { useIntl } from 'react-intl';

const Inventory = ({
  tableProps,
  rule,
  afterDisableFn,
  selectedTags,
  workloads,
  SID,
}) => {
  const intl = useIntl();
  const dispatch = useDispatch();
  const [selected, setSelected] = useState([]);
  const [filters, setFilters] = useState({
    limit: 20,
    offset: 0,
    sort: '-last_seen',
    name: '',
  });
  const entities = useSelector(({ entities }) => entities || {});
  const onSelectRows = (id, selected) =>
    dispatch({ type: 'SELECT_ENTITY', payload: { id, selected } });
  const addNotification = (data) => dispatch(notification(data));
  const [disableRuleModalOpen, setDisableRuleModalOpen] = useState(false);
  const [bulkSelect, setBulkSelect] = useState();

  const remediationDataProvider = () => ({
    issues: [
      {
        id: `advisor:${rule.rule_id}`,
        description: rule.description,
      },
    ],
    systems: selected,
  });

  const onRemediationCreated = (result) => {
    onSelectRows(-1, false);
    try {
      result.remediation && addNotification(result.getNotification());
    } catch (error) {
      addNotification({
        variant: 'danger',
        dismissable: true,
        title: intl.formatMessage(messages.error),
        description: `${error}`,
      });
    }
  };

  const handleModalToggle = (disableRuleModalOpen) => {
    setDisableRuleModalOpen(disableRuleModalOpen);
  };

  const bulkSelectfn = () => {
    setBulkSelect(true);
    onSelectRows(0, true);
  };

  const calculateSelectedItems = () =>
    bulkSelect
      ? setBulkSelect(false)
      : setSelected(
          entities?.rows
            ?.filter((entity) => entity.selected === true)
            .map((entity) => entity.id)
        );

  const createColumns = (defaultColumns) => {
    let lastSeenColumn = defaultColumns.filter(({ key }) => key === 'updated');
    let displayName = defaultColumns.filter(
      ({ key }) => key === 'display_name'
    );
    let systemProfile = defaultColumns.filter(
      ({ key }) => key === 'system_profile'
    );

    displayName = {
      ...displayName[0],
      transforms: [sortable, wrappable],
      props: { isStatic: true },
    };

    lastSeenColumn = {
      ...lastSeenColumn[0],
      transforms: [sortable, wrappable],
      props: { width: 20 },
    };

    systemProfile = {
      ...systemProfile[0],
      transforms: [wrappable],
    };

    return [displayName, systemProfile, lastSeenColumn];
  };

  const handleRefresh = (options) => {
    const { limit, offset, sort, name } = options;
    const refreshedFilters = {
      limit,
      offset,
      sort,
      ...(name && {
        name,
      }),
    };
    setFilters({ ...options });
    urlBuilder(refreshedFilters, selectedTags);
  };

  useEffect(() => {
    entities?.rows?.length && calculateSelectedItems(entities.rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities?.rows]);

  return (
    <React.Fragment>
      {disableRuleModalOpen && (
        <DisableRule
          handleModalToggle={handleModalToggle}
          isModalOpen={disableRuleModalOpen}
          rule={rule}
          afterFn={afterDisableFn}
          hosts={selected}
        />
      )}
      <InventoryTable
        hasCheckbox
        initialLoading
        autoRefresh
        hideFilters={{ all: true, name: false }}
        columns={(defaultColumns) => createColumns(defaultColumns)}
        tableProps={{
          variant: TableVariant.compact,
          ...tableProps,
        }}
        customFilters={{
          selectedTags,
          workloads,
          SID,
        }}
        getEntities={async (_items, config, showTags, defaultGetEntities) => {
          const {
            per_page,
            page,
            orderBy,
            orderDirection,
            selectedTags,
            workloads,
            SID,
          } = config;
          const sort = `${orderDirection === 'ASC' ? '' : '-'}${
            orderBy === 'updated' ? 'last_seen' : orderBy
          }`;
          let options = {
            ...filters,
            limit: per_page,
            offset: page * per_page - per_page,
            sort,
            ...(config.filters.hostnameOrId && {
              name: config?.filters?.hostnameOrId,
            }),
            ...(selectedTags.length && { tags: selectedTags }),
          };

          workloads &&
            (options = { ...options, ...workloadQueryBuilder(workloads, SID) });

          handleRefresh(options);

          const fetchedSystems = (
            await API.get(
              `${RULES_FETCH_URL}${encodeURI(rule.rule_id)}/systems_detail/`,
              {},
              options
            )
          )?.data;

          const results = await defaultGetEntities(
            fetchedSystems.data.map((system) => system.system_uuid),
            {
              page,
              per_page,
              hasItems: true,
              fields: { system_profile: ['operating_system'] },
            },
            showTags
          );

          return Promise.resolve({
            results: mergeArraysByDiffKeys(
              fetchedSystems.data,
              results.results
            ),
            total: fetchedSystems.meta.count,
          });
        }}
        dedicatedAction={
          <RemediationButton
            key="remediation-button"
            isDisabled={selected.length === 0 || rule.playbook_count === 0}
            dataProvider={remediationDataProvider}
            onRemediationCreated={(result) => onRemediationCreated(result)}
          >
            <AnsibeTowerIcon size="sm" className="ins-c-background__default" />
            &nbsp;{intl.formatMessage(messages.remediate)}
          </RemediationButton>
        }
        actionsConfig={{
          actions: [
            '',
            {
              label: intl.formatMessage(messages.disableRuleForSystems),
              props: { isDisabled: selected.length === 0 },
              onClick: () => handleModalToggle(true),
            },
          ],
        }}
        bulkSelect={{
          count: selected.length,
          items: [
            {
              title: intl.formatMessage(messages.selectNone),
              onClick: () => {
                onSelectRows(-1, false);
              },
            },
            {
              ...(entities?.rows?.length > filters.limit
                ? {
                    title: intl.formatMessage(messages.selectPage, {
                      items: filters.limit,
                    }),
                    onClick: () => {
                      onSelectRows(0, true);
                    },
                  }
                : {}),
            },
            {
              ...(entities?.rows?.length > 0
                ? {
                    title: intl.formatMessage(messages.selectAll, {
                      items: entities?.total || 0,
                    }),
                    onClick: async () => {
                      const allSystems = (
                        await API.get(
                          `${RULES_FETCH_URL}${encodeURI(
                            rule.rule_id
                          )}/systems/`,
                          {},
                          { name: filters.name }
                        )
                      )?.data?.host_ids;
                      setSelected(allSystems);
                      bulkSelectfn();
                    },
                  }
                : {}),
            },
          ],
          checked:
            (selected.length === entities?.rows?.length ||
              selected.length === entities?.total) &&
            entities?.total > 0
              ? 1
              : selected.length === filters.limit
              ? null
              : 0,
          onSelect: () => {
            selected.length > 0 ? onSelectRows(-1, false) : bulkSelectfn();
            calculateSelectedItems();
          },
        }}
        fallback={Loading}
        onLoad={({
          mergeWithEntities,
          INVENTORY_ACTION_TYPES,
          mergeWithDetail,
        }) => {
          getRegistry().register({
            ...mergeWithEntities(systemReducer([], INVENTORY_ACTION_TYPES), {
              page: Number(filters.offset / filters.limit + 1 || 1),
              perPage: Number(filters.limit || 20),
            }),
            ...mergeWithDetail(),
          });
        }}
      />
    </React.Fragment>
  );
};

Inventory.propTypes = {
  tableProps: PropTypes.any,
  rule: PropTypes.object,
  afterDisableFn: PropTypes.func,
  selectedTags: PropTypes.any,
  workloads: PropTypes.any,
  SID: PropTypes.any,
};

export default Inventory;
